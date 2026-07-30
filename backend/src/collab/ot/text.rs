// Human: Server-authoritative OT for plain-text replace ops (unicode scalar indices).
// Agent: PURE; MUST stay in parity with frontend/src/lib/collab/ot/text.ts.

use serde::{Deserialize, Serialize};

/// Human: Atomic text mutation — delete `delete` chars at `index`, then insert `insert`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextReplace {
    pub index: usize,
    pub delete: usize,
    pub insert: String,
}

impl TextReplace {
    pub fn insert_len(&self) -> usize {
        self.insert.chars().count()
    }

    pub fn end(&self) -> usize {
        self.index.saturating_add(self.delete)
    }
}

/// Human: Apply a replace to a plain string using unicode scalar indices.
pub fn apply_replace(text: &str, op: &TextReplace) -> String {
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let index = op.index.min(len);
    let end = (index + op.delete).min(len);
    let mut out = String::with_capacity(text.len() + op.insert.len());
    out.extend(chars[..index].iter().copied());
    out.push_str(&op.insert);
    out.extend(chars[end..].iter().copied());
    out
}

/// Human: Transform `op` so it can be applied after `against` has already been applied.
/// Agent: Server-authoritative left-transform; BOTH ops concurrent against same parent.
pub fn transform_replace(op: &TextReplace, against: &TextReplace) -> TextReplace {
    let a_idx = op.index as i64;
    let a_del = op.delete as i64;
    let a_end = a_idx + a_del;

    let b_idx = against.index as i64;
    let b_del = against.delete as i64;
    let b_end = b_idx + b_del;
    let b_ins = against.insert_len() as i64;

    // B entirely before A's start → shift A by B's net length change.
    if b_end <= a_idx {
        return TextReplace {
            index: (a_idx - b_del + b_ins).max(0) as usize,
            delete: op.delete,
            insert: op.insert.clone(),
        };
    }

    // B starts at or after A's end → A unchanged.
    if b_idx >= a_end {
        return TextReplace {
            index: op.index,
            delete: op.delete,
            insert: op.insert.clone(),
        };
    }

    // Overlap: recompute delete range that remains after B removed/inserted text.
    if b_idx <= a_idx {
        // B starts at or before A.
        let overlap = a_end.min(b_end) - a_idx;
        let new_del = (a_del - overlap).max(0);
        let new_idx = b_idx + b_ins;
        TextReplace {
            index: new_idx.max(0) as usize,
            delete: new_del as usize,
            insert: op.insert.clone(),
        }
    } else {
        // B starts inside A's delete range.
        let before = b_idx - a_idx;
        let after = (a_end - b_end).max(0);
        TextReplace {
            index: op.index,
            delete: (before + after) as usize,
            insert: op.insert.clone(),
        }
    }
}

/// Human: Transform `op` through a sequence of already-applied concurrent ops in order.
pub fn transform_replace_through(op: &TextReplace, against: &[TextReplace]) -> TextReplace {
    let mut current = op.clone();
    for other in against {
        current = transform_replace(&current, other);
    }
    current
}

/// Human: Shift a caret/selection offset through an applied replace.
pub fn transform_offset(offset: usize, op: &TextReplace) -> usize {
    let idx = op.index;
    let del = op.delete;
    let ins = op.insert_len();
    if offset <= idx {
        return offset;
    }
    if offset >= idx + del {
        return offset - del + ins;
    }
    // Inside deleted span → land at insert end (after inserted text).
    idx + ins
}

/// Human: Shift an exclusive [start, end) range through a replace; collapse to empty if invalid.
pub fn transform_range(start: usize, end: usize, op: &TextReplace) -> Option<(usize, usize)> {
    if end <= start {
        return None;
    }
    let s = transform_offset(start, op);
    let e = transform_offset(end, op);
    if e > s {
        Some((s, e))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_insert_middle() {
        let text = "hello";
        let op = TextReplace {
            index: 2,
            delete: 0,
            insert: "XX".into(),
        };
        assert_eq!(apply_replace(text, &op), "heXXllo");
    }

    #[test]
    fn apply_delete() {
        let text = "hello";
        let op = TextReplace {
            index: 1,
            delete: 3,
            insert: String::new(),
        };
        assert_eq!(apply_replace(text, &op), "ho");
    }

    #[test]
    fn apply_replace_span() {
        let text = "hello";
        let op = TextReplace {
            index: 1,
            delete: 3,
            insert: "i".into(),
        };
        assert_eq!(apply_replace(text, &op), "hio");
    }

    #[test]
    fn transform_inserts_before() {
        // A inserts at 5, B inserts at 1 first → A shifts by 2
        let a = TextReplace {
            index: 5,
            delete: 0,
            insert: "A".into(),
        };
        let b = TextReplace {
            index: 1,
            delete: 0,
            insert: "BB".into(),
        };
        let a2 = transform_replace(&a, &b);
        assert_eq!(a2.index, 7);
        assert_eq!(a2.insert, "A");
    }

    #[test]
    fn transform_inserts_after() {
        let a = TextReplace {
            index: 1,
            delete: 0,
            insert: "A".into(),
        };
        let b = TextReplace {
            index: 5,
            delete: 0,
            insert: "BB".into(),
        };
        let a2 = transform_replace(&a, &b);
        assert_eq!(a2.index, 1);
    }

    #[test]
    fn concurrent_inserts_same_index_both_kept() {
        // Server applies B first at index 2; A also at 2 → A lands after B insert.
        let base = "abcd";
        let a = TextReplace {
            index: 2,
            delete: 0,
            insert: "A".into(),
        };
        let b = TextReplace {
            index: 2,
            delete: 0,
            insert: "B".into(),
        };
        let after_b = apply_replace(base, &b);
        let a2 = transform_replace(&a, &b);
        let final_text = apply_replace(&after_b, &a2);
        // B then A at same point: "abBAcd"
        assert_eq!(final_text, "abBAcd");
    }

    #[test]
    fn concurrent_edits_different_ends_converge() {
        let base = "hello world";
        // User1 inserts "X" at start
        let a = TextReplace {
            index: 0,
            delete: 0,
            insert: "X".into(),
        };
        // User2 inserts "Y" at end
        let b = TextReplace {
            index: 11,
            delete: 0,
            insert: "Y".into(),
        };

        // Server order: A then B
        let s1 = apply_replace(base, &a);
        let b_after_a = transform_replace(&b, &a);
        let s_ab = apply_replace(&s1, &b_after_a);

        // Server order: B then A
        let s2 = apply_replace(base, &b);
        let a_after_b = transform_replace(&a, &b);
        let s_ba = apply_replace(&s2, &a_after_b);

        assert_eq!(s_ab, "Xhello worldY");
        assert_eq!(s_ba, "Xhello worldY");
        assert_eq!(s_ab, s_ba);
    }

    #[test]
    fn transform_delete_against_prior_insert() {
        let a = TextReplace {
            index: 5,
            delete: 2,
            insert: String::new(),
        };
        let b = TextReplace {
            index: 0,
            delete: 0,
            insert: "ZZ".into(),
        };
        let a2 = transform_replace(&a, &b);
        assert_eq!(a2.index, 7);
        assert_eq!(a2.delete, 2);
    }

    #[test]
    fn transform_overlapping_delete() {
        // A deletes [2,6), B deletes [3,5) first
        let a = TextReplace {
            index: 2,
            delete: 4,
            insert: String::new(),
        };
        let b = TextReplace {
            index: 3,
            delete: 2,
            insert: String::new(),
        };
        let base = "0123456789";
        let after_b = apply_replace(base, &b); // "01256789"
        let a2 = transform_replace(&a, &b);
        let final_text = apply_replace(&after_b, &a2);
        // A wanted to remove chars at 2,3,4,5 → after B removed 3,4, remaining 2 and 5
        assert_eq!(final_text, "016789");
    }

    #[test]
    fn unicode_indices_are_scalar() {
        let text = "a😀b";
        let op = TextReplace {
            index: 1,
            delete: 1,
            insert: "X".into(),
        };
        assert_eq!(apply_replace(text, &op), "aXb");
    }

    #[test]
    fn transform_offset_inside_delete() {
        let op = TextReplace {
            index: 2,
            delete: 3,
            insert: "ZZ".into(),
        };
        assert_eq!(transform_offset(0, &op), 0);
        assert_eq!(transform_offset(2, &op), 2);
        assert_eq!(transform_offset(3, &op), 4); // inside → end of insert
        assert_eq!(transform_offset(5, &op), 4);
        assert_eq!(transform_offset(6, &op), 5);
    }

    #[test]
    fn multi_op_chain_transform() {
        let base = "abcdef";
        let ops = [
            TextReplace {
                index: 1,
                delete: 0,
                insert: "1".into(),
            },
            TextReplace {
                index: 4,
                delete: 1,
                insert: "22".into(),
            },
        ];
        let client = TextReplace {
            index: 5,
            delete: 0,
            insert: "X".into(),
        };
        let transformed = transform_replace_through(&client, &ops);
        let mut text = base.to_string();
        for op in &ops {
            text = apply_replace(&text, op);
        }
        text = apply_replace(&text, &transformed);
        // After insert at 1 and replace at (shifted) 4: "a1bc22ef" then X near original 5
        assert!(text.contains('X'));
        assert_eq!(text.chars().count(), base.chars().count() + 1 + 1 + 1);
    }

    #[test]
    fn shared_fixtures_json_parity() {
        let raw = include_str!("fixtures.json");
        let root: serde_json::Value = serde_json::from_str(raw).expect("fixtures json");
        let cases = root["cases"].as_array().expect("cases");
        for case in cases {
            let name = case["name"].as_str().unwrap_or("?");
            if let Some(base) = case["base"].as_str() {
                if let (Some(a), Some(b)) = (case.get("a"), case.get("b")) {
                    let a = parse_fix(a);
                    let b = parse_fix(b);
                    if case["apply_b_first"].as_bool() == Some(true) {
                        let after_b = apply_replace(base, &b);
                        let a2 = transform_replace(&a, &b);
                        let result = apply_replace(&after_b, &a2);
                        assert_eq!(result, case["result"].as_str().unwrap(), "{name}");
                    } else {
                        let s1 = apply_replace(base, &a);
                        let b2 = transform_replace(&b, &a);
                        let ab = apply_replace(&s1, &b2);
                        let s2 = apply_replace(base, &b);
                        let a2 = transform_replace(&a, &b);
                        let ba = apply_replace(&s2, &a2);
                        if let Some(exp) = case["result_ab"].as_str() {
                            assert_eq!(ab, exp, "{name} ab");
                        }
                        if let Some(exp) = case["result_ba"].as_str() {
                            assert_eq!(ba, exp, "{name} ba");
                        }
                    }
                } else if let Some(op) = case.get("op") {
                    let result = apply_replace(base, &parse_fix(op));
                    assert_eq!(result, case["result"].as_str().unwrap(), "{name}");
                }
            } else if let (Some(a), Some(b), Some(a_after)) =
                (case.get("a"), case.get("b"), case.get("a_after_b"))
            {
                let got = transform_replace(&parse_fix(a), &parse_fix(b));
                let exp = parse_fix(a_after);
                assert_eq!(got, exp, "{name}");
            }
        }
    }

    fn parse_fix(v: &serde_json::Value) -> TextReplace {
        TextReplace {
            index: v["index"].as_u64().unwrap() as usize,
            delete: v["delete"].as_u64().unwrap_or(0) as usize,
            insert: v["insert"].as_str().unwrap_or("").to_string(),
        }
    }
}
