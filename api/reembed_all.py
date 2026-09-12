"""全量重新向量化所有无向量文档（embedding 分批修复后）。"""
import sys
import time
from app.services.store import store

ADMIN_ID = "229dd9c533bf44bd9ffd3dc7e479b509"

docs = store.all(user_id=ADMIN_ID)
need = []
for d in docs:
    chunks = d.get("chunks") or []
    if chunks and not any(c.get("vector") for c in chunks):
        need.append(d)

print(f"共 {len(docs)} 篇，需重新向量化 {len(need)} 篇", flush=True)

ok = 0
fail = 0
t0 = time.time()
for idx, d in enumerate(need, 1):
    try:
        r = store.update(d["id"], text=d["text"], user_id=ADMIN_ID)
        if r is None:
            fail += 1
            print(f"  [{idx}/{len(need)}] FAILED(无权限): {d['title']}", flush=True)
        else:
            ok += 1
    except Exception as e:
        fail += 1
        print(f"  [{idx}/{len(need)}] ERROR: {d['title']} -> {type(e).__name__}", flush=True)
    if idx % 10 == 0 or idx == len(need):
        el = time.time() - t0
        print(f"  进度 {idx}/{len(need)}，成功 {ok}，失败 {fail}，耗时 {el:.0f}s", flush=True)

print(f"=== 完成：成功 {ok}，失败 {fail}，总耗时 {time.time()-t0:.0f}s ===", flush=True)
