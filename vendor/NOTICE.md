# 同梱している第三者のファイル

## @mediapipe/tasks-vision 1.2.3（Apache-2.0）

- 取得元: https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.2.3.tgz
- npm registry の integrity: `sha512-sxJyfhbN+EamexhaaCmUlw7v8vWWMum7VDsORe6d4c8Dk/xlI4qiIgoSw9cE9hpvYhVRRVLIA8y605FbqWkNeQ==`
- ライセンス全文: vendor/mediapipe/LICENSE
- 同梱したのは SIMD 版の wasm だけ。Chrome 116 以降は SIMD に対応している

## face_landmarker.task（float16 v1、Apache-2.0）

- 取得元: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

## 各ファイルの SHA-256

```
fb0c02c296f44ce0cc324ba16bd646d8773eb4a7847db4019cc4d0430db7a9b5  mediapipe/vision_bundle.mjs
2aa5fd3fdd3d8208cd7587df0bb19fb6925c4ea16a76dd025aedc1f64d6a6309  mediapipe/wasm/vision_wasm_internal.js
225bc06c0f51a9cf31fea0e9e0b0243e9e01fb5ef332cc1a7fa6656dbdfdaabf  mediapipe/wasm/vision_wasm_internal.wasm
64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff  models/face_landmarker.task
```

取得元のファイルと同じ内容であることは、取得元から改めて落として `shasum -a 256` を比べれば確認できる。
