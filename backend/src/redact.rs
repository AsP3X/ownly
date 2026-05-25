// Human: Redact sensitive strings before they appear in logs.
// Agent: READS raw tokens/emails/urls; RETURNS truncated or masked strings; NO side effects.

pub fn email_for_log(email: &str) -> String {
    let email = email.trim();
    if let Some((local, domain)) = email.split_once('@') {
        let visible = local.chars().take(2).collect::<String>();
        format!("{visible}***@{domain}")
    } else {
        "***".into()
    }
}

pub fn bearer_token_for_log(token: &str) -> String {
    let token = token.trim();
    if token.len() <= 8 {
        "***".into()
    } else {
        format!("{}…{}", &token[..4], &token[token.len() - 4..])
    }
}

pub fn url_for_log(url: &str) -> String {
    if url.len() > 80 {
        format!("{}…", &url[..77])
    } else {
        url.to_string()
    }
}
