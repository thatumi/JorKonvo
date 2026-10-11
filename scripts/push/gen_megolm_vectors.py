#!/usr/bin/env python3
# Usage: pip install vodozemac && python3 scripts/push/gen_megolm_vectors.py > apps/web/android/app/src/test/resources/megolm_vectors.json
"""Generates Megolm decryption test vectors with vodozemac (the reference
implementation) for the app's own native decrypters."""
import base64, json, sys
import vodozemac as v

def b64(b): return base64.b64encode(b).decode().rstrip("=")

g = v.GroupSession()
initial_key = g.session_key  # before any encrypt: index 0
plain = lambda i: json.dumps({"type": "m.room.message", "room_id": "!r:example.org",
                              "content": {"msgtype": "m.text", "body": f"üzenet #{i} – héllo"}}, ensure_ascii=False)
wanted = {0, 1, 2, 255, 256, 257, 65535, 65536, 70000}
msgs = {}
for i in range(max(wanted) + 1):
    m = g.encrypt(plain(i).encode())
    if i in wanted:
        msgs[i] = m.to_base64()
inb = v.InboundGroupSession(initial_key)
for i, ct in msgs.items():  # sanity: the reference decrypts its own vectors
    assert inb.decrypt(v.MegolmMessage.from_base64(ct)).plaintext.decode() == plain(i)

def export_at(idx):
    ek = inb.export_at(idx)
    return ek.to_base64() if hasattr(ek, "to_base64") else ek

vectors = {
    "session_id": g.session_id,
    "exports": {str(k): export_at(k) for k in (0, 2, 256, 65536)},
    "messages": {str(k): {"ciphertext": ct, "plaintext": plain(k)} for k, ct in msgs.items()},
}
# tampered: flip a ciphertext bit -> MAC must fail
raw = bytearray(base64.b64decode(msgs[1] + "=="))
raw[10] ^= 1
vectors["tampered_index1"] = b64(bytes(raw))
json.dump(vectors, sys.stdout, ensure_ascii=False, indent=1)
