# scripts/seed_faces.py - register face embeddings for sample employees
# Run once after the stack is up. Place one clear frontal photo per employee
# under samples/<employee_code>.jpg then run:
#     python scripts/seed_faces.py --api http://localhost/api --user admin --pwd 'Admin@HRM2024!'
#
# Requires: pip install requests insightface onnxruntime opencv-python-headless
"""
HRM seed_faces - send one image per employee to /api/employees to register face embeddings.
"""
import argparse
import os
import sys
import glob
import requests


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost/api", help="Backend base URL")
    ap.add_argument("--user", required=True, help="Admin username")
    ap.add_argument("--pwd",  required=True, help="Admin password")
    ap.add_argument("--samples", default="samples", help="Folder with <employee_code>.jpg files")
    args = ap.parse_args()

    # 1) login
    r = requests.post(f"{args.api}/auth/login", json={"username": args.user, "password": args.pwd}, timeout=15)
    r.raise_for_status()
    token = r.json()["data"]["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2) list employees
    r = requests.get(f"{args.api}/employees?status=active&limit=500", headers=headers, timeout=15)
    r.raise_for_status()
    emps = {e["employee_code"]: e for e in r.json()["data"]}

    # 3) for each sample, post a face-update (we'll delete + re-create)
    samples = glob.glob(os.path.join(args.samples, "*.jpg")) + glob.glob(os.path.join(args.samples, "*.png"))
    if not samples:
        print(f"No sample images found under {args.samples}/<code>.jpg")
        sys.exit(1)

    ok = 0
    fail = 0
    for path in samples:
        code = os.path.splitext(os.path.basename(path))[0]
        emp = emps.get(code)
        if not emp:
            print(f"  SKIP {code}: no employee with that code in DB")
            fail += 1
            continue
        if emp.get("has_face"):
            print(f"  SKIP {code}: already has face (delete via DB to re-register)")
            continue
        with open(path, "rb") as f:
            files = {"file": (os.path.basename(path), f, "image/jpeg")}
            # Backend PUT /employees/:id accepts multipart; text fields are optional.
            r = requests.put(
                f"{args.api}/employees/{emp['id']}",
                headers=headers, files=files, timeout=60,
            )
        if r.ok:
            print(f"  OK   {code}")
            ok += 1
        else:
            print(f"  FAIL {code}: {r.status_code} {r.text[:200]}")
            fail += 1

    print(f"Done: {ok} ok, {fail} failed")


if __name__ == "__main__":
    main()
