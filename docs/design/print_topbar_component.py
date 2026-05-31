import json

with open("login-signup.pen", "r", encoding="utf-8") as f:
    doc = json.load(f)

for child in doc["children"]:
    if child.get("id") == "w7t69Z":
        print(json.dumps(child, indent=2))
