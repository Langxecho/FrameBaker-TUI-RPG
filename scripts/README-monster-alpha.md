# 怪物动作帧 Alpha 审计 / Monster Alpha Audit

只读检查 R1-A ZIP (`frames/{action}/*.png`)、`.monster` ZIP (`assets/{action}/*.png`)，也支持制作端原始 `{action}/*.png` 或 `{action}/24fps/*.png` ZIP。不会提取或修改归档，不改包格式、origin、运行时或素材数据库。此工具仅报告 alpha 数据，不判断抠图边缘或美术质量。

```powershell
.\.venv-media\Scripts\python.exe scripts\audit_monster_alpha.py path\to\monster.monster --output target\monster-alpha.json
.\.venv-media\Scripts\python.exe scripts\audit_monster_alpha.py path\to\frames.zip --output target\frames-alpha.json --require-transparency
```

报告路径必须不存在，拒绝覆盖。每帧记录 PNG SHA-256、动作、尺寸、全不透明/全透明空帧、透明/半透明/不透明像素和边缘 alpha；每动作汇总帧数、尺寸集合与 alpha 计数，同时记录输入归档 SHA-256。`--require-transparency` 仅用于调用者明确要求透明 sprite 的场合：任何全不透明帧或全透明空帧返回 **2**，报告仍写出；其他有效审计返回 **0**；坏 ZIP/PNG、超预算或输出已存在返回 **1**，不产生新报告。半透明像素视为具有 alpha，但不代表边缘已合格。

预算：压缩归档 512 MiB、总解压 1 GiB、单帧 16 MiB、最多 4096 帧、单帧 400 万像素、总计 10 亿像素。异常归档/PNG 失败关闭。测试：`.\.venv-media\Scripts\python.exe -m unittest discover -s tests -p test_audit_monster_alpha.py`。

English: This is an offline, read-only alpha fact report for action-frame ZIPs. The optional gate is not a general package admission rule or visual-quality approval.
