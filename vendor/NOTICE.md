# 同梱している第三者のファイル

## @mediapipe/tasks-vision 1.1.0（Apache-2.0）

- 取得元: https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.1.0.tgz
- npm registry の integrity: `sha512-ZJqh0wMKOINorfSffvDAxzyO1//c+FiG3IkzOdNDnLqvBB3DbMfj0bB/tys2SNf9S914sgoIbIpF4HTOi336cg==`
- ライセンス全文: vendor/mediapipe/LICENSE
- 同梱したのは SIMD 版の wasm だけ。Chrome 116 以降は SIMD に対応している

## face_landmarker.task（float16 v1、Apache-2.0）

- 取得元: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

## 各ファイルの SHA-256

```
9d5fc9ef74b22329cf9aa88dc543956d192b8c254210b187271614713eb5b10c  mediapipe/vision_bundle.mjs
7c652617b5bef832f42878ce8c5f752b0724bca6054e4bc1013a37d4b1949723  mediapipe/wasm/vision_wasm_internal.js
782eda3ec1f414fdb4f1d66a8b59093eb4d5ab437e06117796abf05962d68eef  mediapipe/wasm/vision_wasm_internal.wasm
64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff  models/face_landmarker.task
```

取得元のファイルと同じ内容であることは、取得元から改めて落として `shasum -a 256` を比べれば確認できる。
