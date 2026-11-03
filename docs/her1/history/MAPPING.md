# her1 映射表
更新：2026-10-24 22:26（Asia/Shanghai）

- scale=0.477671 placement=[85, 221]
- alpha hard thr=128
- method: native hard-alpha thr128 → LANCZOS RGB + NEAREST alpha → re-hard; height-match redraw1; center-x

| 她的层/来源 | FB group_key | file | native | canvas_offset | pivot | bone | 选用理由 |
|---|---|---|---|---|---|---|---|
| 头 | att-head | att-head-her1.png | 126×117 | [116, 226] | [0.680,0.164] | head | 层「头」；cheek 无分层→拷贝 |
| 头(拷贝) | att-head_cheek | att-head_cheek-her1.png | 126×117 | [116, 226] | [0.680,0.164] | head | 无 wink 分层；暂=head 拷贝（勿改旧 cheek scale 轨） |
| 腰以上 | att-torso_upper | att-torso_upper-her1.png | 105×124 | [136, 311] | [0.721,0.206] | chest | 层「腰以上」→torso_upper |
| 裙子胯上段 | att-torso_lower | att-torso_lower-her1.png | 113×36 | [142, 435] | [0.629,0.194] | spine | 裙子胯上段；split_y=471 overlap=8 bbox=(131, 435, 266, 531) |
| 裙子胯下段 | att-pelvis | att-pelvis-her1.png | 135×68 | [131, 463] | [0.432,0.578] | pelvis | 裙子胯下段；split_y=471 overlap=8 bbox=(131, 435, 266, 531) |
| 近处大臂 | att-upper_arm_near | att-upper_arm_near-her1.png | 70×61 | [126, 326] | [0.717,0.860] | upper_arm_near | 层「近处大臂」 |
| 近处小臂(去手套) | att-forearm_near | att-forearm_near-her1.png | 46×34 | [194, 354] | [0.611,0.800] | forearm_near | 近处小臂仅保留皮肤；手套交给 grip-hand；与手互斥 |
| 远处大臂 | att-p19x-upper_arm_far_c22c | att-p19x-upper_arm_far_c22c-her1.png | 61×84 | [199, 334] | [0.352,0.897] | upper_arm_far | 层「远处大臂」 |
| 远处小臂(去手套) | att-p19x-forearm_far_c21c | att-p19x-forearm_far_c21c-her1.png | 25×39 | [259, 379] | [0.299,0.824] | forearm_far | 远处小臂仅保留皮肤；手套交给 support；与手互斥 |
| 近侧大腿 | att-thigh_near | att-thigh_near-her1.png | 73×105 | [122, 531] | [0.541,0.991] | thigh_near | 层「近侧大腿」 |
| 近侧小腿 | att-calf_near | att-calf_near-her1.png | 62×110 | [102, 629] | [0.629,0.933] | calf_near | 层「近侧小腿」 |
| 近侧脚 | att-shoe_near | att-shoe_near-her1.png | 56×93 | [90, 722] | [0.458,0.916] | shoe_near | 层「近侧脚」 |
| 远侧大腿 | att-thigh_far | att-thigh_far-her1.png | 70×108 | [213, 531] | [0.400,0.991] | thigh_far | 层「远侧大腿」 |
| 远处小腿 | att-calf_far | att-calf_far-her1.png | 53×88 | [250, 639] | [0.115,0.914] | calf_far | 层「远处小腿」 |
| 远处脚 | att-shoe_far | att-shoe_far-her1.png | 88×82 | [260, 710] | [0.170,0.897] | shoe_far | 层「远处脚」 |
| 近侧膝盖 | att-p19x-knee_near_g1 | att-p19x-knee_near_g1-her1.png | 54×32 | [122, 604] | [0.500,0.500] | calf_near | 层「近侧膝盖」 |
| 远侧膝盖 | att-p19x-knee_far_g1 | att-p19x-knee_far_g1-her1.png | 43×46 | [240, 593] | [0.500,0.500] | calf_far | 层「远侧膝盖」 |
| 枪 | gun_K05 | gun_K05-her1.png | 73×50 | [260, 324] | [0.162,0.640] | hand_near | 层「枪」→gun-rigid |
| 近侧射击手→手套裁 | hand_fire_g1 | hand_fire_g1_y-her1.png | 72×44 | [236, 338] | [0.395,1.000] | hand_near | 近侧射击手 thick-dark 手套裁切（非整臂） |
| 远处支撑手→手套裁 | hand_sup_g1 | hand_sup_g1_y-her1.png | 54×52 | [264, 350] | [0.267,0.704] | hand_near | 远处支撑手 thick-dark 手套裁切（非整臂） |
| (无) | att-shoulder_cap_near | att-shoulder_cap_near-her1.png | 27×25 | [143, 349] | [0.704,0.080] | scapula_near | 源无肩罩；空占位可沿用旧件 |
| (无) | cap_near | att-cap_near-her1.png | 14×14 | [219, 398] | [0.500,0.500] | forearm_near | 源无近肘帽；空 |
| (无) | cap_far | att-cap_far-her1.png | 14×14 | [300, 412] | [0.500,0.500] | forearm_far | 源无远肘帽；空 |
| (无) | att-p19y-elbow_far-c21-p65 | att-p19y-elbow_far-c21-p65-her1.png | 72×72 | [271, 383] | [0.500,0.500] | forearm_far | 源无远肘桶；空占位 |

## 手/臂决策

{
  "near_fire": {
    "chosen": "glove spatial crop from 近侧射击手",
    "forearm": "近处小臂 strip glove",
    "upper_arm": "近处大臂",
    "compare": "work/cmp_hand_fire_crop.png",
    "opaque_px": 1886
  },
  "far_support": {
    "chosen": "glove spatial crop from 远处支撑手",
    "forearm": "远处小臂 strip glove",
    "upper_arm": "远处大臂",
    "compare": "work/cmp_hand_sup_crop.png",
    "opaque_px": 1380
  }
}

## 裙子分割

split_y=471 overlap=8 bbox=(131, 435, 266, 531)

身体层仅备份：`work/backup_身体_*`，不入库。
