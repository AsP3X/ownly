#!/usr/bin/env python3
"""Sync Ownly Explorer + public-share image viewer frames in login-signup.pen with frontend implementation."""

from __future__ import annotations

import json
from pathlib import Path

PEN_PATH = Path(__file__).resolve().parents[1] / "docs" / "design" / "login-signup.pen"

# Human: ImagePreviewDialog uses 1.5× the original 800×600 Pencil baseline on desktop.
LIGHTBOX_WIDTH = 1200
LIGHTBOX_HEIGHT = 900
CANVAS_WIDTH = 1440
CANVAS_HEIGHT = 1024
NAV_SIZE = 50
NAV_GAP = 16

LIGHTBOX_X = (CANVAS_WIDTH - LIGHTBOX_WIDTH) // 2
LIGHTBOX_Y = (CANVAS_HEIGHT - LIGHTBOX_HEIGHT) // 2
PREV_X = LIGHTBOX_X - NAV_SIZE - NAV_GAP
NEXT_X = LIGHTBOX_X + LIGHTBOX_WIDTH + NAV_GAP
NAV_Y = LIGHTBOX_Y + (LIGHTBOX_HEIGHT - NAV_SIZE) // 2
CLOSE_X = LIGHTBOX_WIDTH - 44 - 16
BOTTOM_BAR_Y = LIGHTBOX_HEIGHT - 64


def find_frame_by_id(node: dict, target_id: str) -> dict | None:
    if node.get("id") == target_id:
        return node
    for child in node.get("children") or []:
        if isinstance(child, dict):
            found = find_frame_by_id(child, target_id)
            if found is not None:
                return found
    return None


def find_frame_by_name(node: dict, target_name: str) -> dict | None:
    if node.get("name") == target_name:
        return node
    for child in node.get("children") or []:
        if isinstance(child, dict):
            found = find_frame_by_name(child, target_name)
            if found is not None:
                return found
    return None


def update_explorer_image_viewer(root: dict) -> None:
    frame = find_frame_by_name(root, "Ownly Explorer Image Viewer")
    if frame is None:
        raise RuntimeError("Ownly Explorer Image Viewer frame not found")

    backdrop = find_frame_by_name(frame, "Viewer Blurred Backdrop")
    if backdrop is not None:
        backdrop["fill"] = "#0A0A10CC"
        backdrop.setdefault("effect", {})["type"] = "background_blur"
        backdrop["effect"]["radius"] = 40

    prev_btn = find_frame_by_name(frame, "Prev Image Button")
    if prev_btn is not None:
        prev_btn.update({"x": PREV_X, "y": NAV_Y, "width": NAV_SIZE, "height": NAV_SIZE})

    next_btn = find_frame_by_name(frame, "Next Image Button")
    if next_btn is not None:
        next_btn.update({"x": NEXT_X, "y": NAV_Y, "width": NAV_SIZE, "height": NAV_SIZE})

    card = find_frame_by_name(frame, "Lightbox Image Card")
    if card is not None:
        card.update(
            {
                "x": LIGHTBOX_X,
                "y": LIGHTBOX_Y,
                "width": LIGHTBOX_WIDTH,
                "height": LIGHTBOX_HEIGHT,
                "stroke": "#FFFFFF1A",
            }
        )

    photo = find_frame_by_name(card or {}, "Scenic Photo Frame")
    if photo is not None:
        photo.update({"width": LIGHTBOX_WIDTH, "height": LIGHTBOX_HEIGHT})
        if isinstance(photo.get("fill"), dict):
            photo["fill"]["mode"] = "fit"

    bottom = find_frame_by_name(card or {}, "Translucent Bottom Bar")
    if bottom is not None:
        bottom.update({"width": LIGHTBOX_WIDTH, "y": BOTTOM_BAR_Y, "fill": "#00000099"})

    close_btn = find_frame_by_name(card or {}, "Close Lightbox Button")
    if close_btn is not None:
        close_btn.update(
            {
                "x": CLOSE_X,
                "y": 16,
                "fill": "#00000099",
                "stroke": "#FFFFFF33",
            }
        )


def build_public_share_inline_image_card() -> dict:
    return {
        "type": "frame",
        "id": "mgtNJ",
        "name": "Inline Image Preview Card",
        "clip": True,
        "width": "fill_container",
        "height": "fill_container",
        "fill": "#FFFFFF",
        "cornerRadius": "$radius-2xl",
        "stroke": "#E5E7EB",
        "strokeWidth": 1,
        "effect": {
            "type": "shadow",
            "shadowType": "outer",
            "color": "#00000014",
            "offset": {"x": 0, "y": 12},
            "blur": 32,
        },
        "layout": "vertical",
        "children": [
            {
                "type": "frame",
                "id": "imgHdr1",
                "name": "Image Preview Header",
                "width": "fill_container",
                "fill": "#111118",
                "stroke": "#E5E7EB",
                "strokeWidth": {"bottom": 1},
                "padding": [12, 20],
                "justifyContent": "space_between",
                "alignItems": "center",
                "children": [
                    {
                        "type": "frame",
                        "id": "imgHdrL",
                        "name": "Header Left",
                        "gap": 8,
                        "alignItems": "center",
                        "children": [
                            {
                                "type": "icon",
                                "id": "imgHdrIco",
                                "name": "Image Icon",
                                "width": 16,
                                "height": 16,
                                "icon": "image",
                                "library": "lucide",
                                "fill": "#93C5FD",
                            },
                            {
                                "type": "text",
                                "id": "imgHdrNm",
                                "name": "File Name",
                                "fill": "#FFFFFF",
                                "content": "sunset_landscape.jpg",
                                "fontFamily": "$font-sans",
                                "fontSize": 14,
                                "fontWeight": "600",
                            },
                        ],
                    },
                    {
                        "type": "frame",
                        "id": "imgHdrR",
                        "name": "Header Actions",
                        "gap": 8,
                        "alignItems": "center",
                        "children": [
                            {
                                "type": "frame",
                                "id": "imgZoomOut",
                                "name": "Zoom Out Button",
                                "width": 32,
                                "height": 32,
                                "fill": "#FFFFFF1A",
                                "cornerRadius": 8,
                                "justifyContent": "center",
                                "alignItems": "center",
                                "children": [
                                    {
                                        "type": "icon",
                                        "id": "imgZoomOutIco",
                                        "name": "Minus Icon",
                                        "width": 16,
                                        "height": 16,
                                        "icon": "minus",
                                        "library": "lucide",
                                        "fill": "#FFFFFF",
                                    }
                                ],
                            },
                            {
                                "type": "frame",
                                "id": "imgZoomIn",
                                "name": "Zoom In Button",
                                "width": 32,
                                "height": 32,
                                "fill": "#FFFFFF1A",
                                "cornerRadius": 8,
                                "justifyContent": "center",
                                "alignItems": "center",
                                "children": [
                                    {
                                        "type": "icon",
                                        "id": "imgZoomInIco",
                                        "name": "Plus Icon",
                                        "width": 16,
                                        "height": 16,
                                        "icon": "plus",
                                        "library": "lucide",
                                        "fill": "#FFFFFF",
                                    }
                                ],
                            },
                            {
                                "type": "frame",
                                "id": "imgDlBtn",
                                "name": "Download Button",
                                "fill": "$accent-primary",
                                "cornerRadius": 8,
                                "gap": 6,
                                "padding": [6, 12],
                                "alignItems": "center",
                                "children": [
                                    {
                                        "type": "icon",
                                        "id": "imgDlIco",
                                        "name": "Download Icon",
                                        "width": 14,
                                        "height": 14,
                                        "icon": "download",
                                        "library": "lucide",
                                        "fill": "#FFFFFF",
                                    },
                                    {
                                        "type": "text",
                                        "id": "imgDlTxt",
                                        "name": "Download Label",
                                        "fill": "#FFFFFF",
                                        "content": "Download",
                                        "fontFamily": "$font-sans",
                                        "fontSize": 12,
                                        "fontWeight": "600",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                "type": "frame",
                "id": "imgStage1",
                "name": "Image Preview Stage",
                "width": "fill_container",
                "height": "fill_container",
                "fill": "#111118",
                "padding": 16,
                "justifyContent": "center",
                "alignItems": "center",
                "children": [
                    {
                        "type": "rectangle",
                        "id": "RITg4",
                        "name": "Photo Showcase",
                        "metadata": {
                            "type": "unsplash",
                            "username": "okrema",
                            "link": "https://unsplash.com/@okrema",
                            "author": "Pavel Okrema",
                        },
                        "fill": {
                            "type": "image",
                            "enabled": True,
                            "url": "https://images.unsplash.com/photo-1713961813202-ca6a82994c26?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w4NDM0ODN8MHwxfHJhbmRvbXx8fHx8fHx8fDE3ODAxODEzODV8&ixlib=rb-4.1.0&q=80&w=1080",
                            "mode": "fit",
                        },
                        "width": 760,
                        "height": 520,
                    }
                ],
            },
        ],
    }


def update_public_share_image_preview(root: dict) -> None:
    frame = find_frame_by_name(root, "Ownly Public Shared Files Page - Image Preview")
    if frame is None:
        raise RuntimeError("Ownly Public Shared Files Page - Image Preview frame not found")

    preview_area = find_frame_by_name(frame, "Image Preview Area")
    if preview_area is None:
        raise RuntimeError("Image Preview Area frame not found")

    children = preview_area.get("children") or []
    for index, child in enumerate(children):
        if child.get("id") == "mgtNJ":
            children[index] = build_public_share_inline_image_card()
            preview_area["children"] = children
            return

    raise RuntimeError("Inline image preview card (mgtNJ) not found")


def main() -> None:
    doc = json.loads(PEN_PATH.read_text(encoding="utf-8"))
    update_explorer_image_viewer(doc)
    update_public_share_image_preview(doc)
    PEN_PATH.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Updated image viewer frames in {PEN_PATH}")


if __name__ == "__main__":
    main()
