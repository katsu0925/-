_base_ = []

# ---- モデル定義 ----
model = dict(
    type='TopdownPoseEstimator',
    data_preprocessor=dict(
        type='PoseDataPreprocessor',
        mean=[123.675, 116.28, 103.53],
        std=[58.395, 57.12, 57.375],
        bgr_to_rgb=True),
    backbone=dict(
        type='HRNet',
        in_channels=3,
        extra=dict(
            stage1=dict(num_modules=1, num_branches=1, block='BOTTLENECK',
                        num_blocks=(4,), num_channels=(64,)),
            stage2=dict(num_modules=1, num_branches=2, block='BASIC',
                        num_blocks=(4, 4), num_channels=(48, 96)),
            stage3=dict(num_modules=4, num_branches=3, block='BASIC',
                        num_blocks=(4, 4, 4), num_channels=(48, 96, 192)),
            stage4=dict(num_modules=3, num_branches=4, block='BASIC',
                        num_blocks=(4, 4, 4, 4), num_channels=(48, 96, 192, 384)),
        ),
        init_cfg=dict(
            type='Pretrained',
            checkpoint='https://download.openmmlab.com/mmpose/pretrain_models/'
                       'hrnet_w48-8ef0771d.pth'),
    ),
    head=dict(
        type='HeatmapHead',
        in_channels=48,
        out_channels=10,  # pants: 10キーポイント
        deconv_out_channels=None,
        loss=dict(type='KeypointMSELoss', use_target_weight=True),
        decoder=dict(
            type='MSRAHeatmap',
            input_size=(288, 384),
            heatmap_size=(72, 96),
            sigma=2)),
    test_cfg=dict(flip_test=True, flip_mode='heatmap', shift_heatmap=True),
)

# ---- データ設定 ----
dataset_type = 'CocoDataset'
data_root = 'data/'

train_pipeline = [
    dict(type='LoadImage'),
    dict(type='GetBBoxCenterScale'),
    dict(type='RandomFlip', direction='horizontal',
         flip_indices=[1, 0, 2, 4, 3, 5, 6, 8, 7, 9]),
    dict(type='RandomHalfBody'),
    dict(type='RandomBBoxTransform', scale_factor=[0.6, 1.4], rotate_factor=40),
    dict(type='TopdownAffine', input_size=(288, 384)),
    dict(type='GenerateTarget', encoder=dict(
        type='MSRAHeatmap', input_size=(288, 384),
        heatmap_size=(72, 96), sigma=2)),
    dict(type='PackPoseInputs')
]

val_pipeline = [
    dict(type='LoadImage'),
    dict(type='GetBBoxCenterScale'),
    dict(type='TopdownAffine', input_size=(288, 384)),
    dict(type='PackPoseInputs')
]

train_dataloader = dict(
    batch_size=16,
    num_workers=4,
    persistent_workers=True,
    sampler=dict(type='DefaultSampler', shuffle=True),
    dataset=dict(
        type=dataset_type,
        data_root=data_root,
        data_mode='topdown',
        ann_file='annotations/dummy_pants_train.json',
        data_prefix=dict(img='images/train/'),
        pipeline=train_pipeline,
    ))

val_dataloader = dict(
    batch_size=16,
    num_workers=4,
    persistent_workers=True,
    sampler=dict(type='DefaultSampler', shuffle=False),
    dataset=dict(
        type=dataset_type,
        data_root=data_root,
        data_mode='topdown',
        ann_file='annotations/dummy_pants_val.json',
        data_prefix=dict(img='images/val/'),
        pipeline=val_pipeline,
    ))

val_evaluator = dict(
    type='CocoMetric',
    ann_file=data_root + 'annotations/dummy_pants_val.json',
    use_area=True,
    sigmas=[0.06, 0.06, 0.06, 0.07, 0.07, 0.07, 0.07, 0.06, 0.06, 0.06])

# ---- 学習設定 ----
train_cfg = dict(max_epochs=210, val_interval=10)
val_cfg = dict()
test_cfg = dict()

optim_wrapper = dict(optimizer=dict(type='Adam', lr=5e-4))

param_scheduler = [
    dict(type='LinearLR', begin=0, end=500, start_factor=0.001, by_epoch=False),
    dict(type='MultiStepLR', begin=0, end=210,
         milestones=[170, 200], gamma=0.1, by_epoch=True)
]

# ---- ログ・チェックポイント ----
default_hooks = dict(
    timer=dict(type='IterTimerHook'),
    logger=dict(type='LoggerHook', interval=50),
    param_scheduler=dict(type='ParamSchedulerHook'),
    checkpoint=dict(type='CheckpointHook', interval=10,
                    save_best='coco/AP', rule='greater'),
    sampler_seed=dict(type='DistSamplerSeedHook'),
)

default_scope = 'mmpose'
env_cfg = dict(
    cudnn_benchmark=False,
    mp_cfg=dict(mp_start_method='fork', opencv_num_threads=0),
    dist_cfg=dict(backend='nccl'),
)
log_processor = dict(by_epoch=True)
log_level = 'INFO'
load_from = None
resume = False
