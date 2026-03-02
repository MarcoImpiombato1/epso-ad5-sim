import json, glob, yaml, os

REQUIRED = ["id","lang","section","difficulty","skill","question","choices","answer","explanation"]

def load_all():
    items = []
    for path in sorted(glob.glob("bank/*.yml")):
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or []
        if not isinstance(data, list):
            raise ValueError(f"{path} must be a YAML list")
        for q in data:
            q["__file"] = os.path.basename(path)
            items.append(q)

    seen = set()
    for q in items:
        for k in REQUIRED:
            if k not in q:
                raise ValueError(f"Missing {k} in {q.get('id','<no-id>')} ({q.get('__file')})")
        if q["id"] in seen:
            raise ValueError(f"Duplicate id: {q['id']}")
        seen.add(q["id"])
        if q["answer"] not in q["choices"]:
            raise ValueError(f"Answer not in choices for {q['id']}")
        d = int(q["difficulty"])
        if not (1 <= d <= 5):
            raise ValueError(f"Difficulty must be 1..5 for {q['id']}")

    return items

def main():
    items = load_all()
    out = "site/docs/bank.json"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    # avoid Jekyll
    with open("site/docs/.nojekyll", "w", encoding="utf-8") as f:
        f.write("")
    print(f"Wrote {len(items)} questions -> {out}")

if __name__ == "__main__":
    main()
