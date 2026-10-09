# Selfie segmentation model

`selfie_segmenter_landscape.tflite` is MediaPipe's landscape selfie segmentation model (144×256 input).
The waiting room's device check uses it, through the MediaPipe Image Segmenter, to show the chosen
virtual background behind the person in the camera preview. The browser runs it on the device: no
camera frame leaves it. Inside the room the effect is Jitsi's own.

| | |
|---|---|
| Source | `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite` |
| SHA-256 | `490e9ea734313e0de10fa0cd9e3c6133e36ea4db2b7a49bde9ef019f72796b8e` |
| Model card | [MediaPipe Selfie Segmentation](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf) |
| Authors | Google |
| License | Apache License 2.0, per the model card; the text is in [`LICENSE`](LICENSE) |

The model card states the intended use (segmenting a person in front of a camera in interactive video
applications), its limits and its fairness evaluation. The training images belong to Google and are
not distributed.

The engine that runs the model is the `@mediapipe/tasks-vision` npm package (Apache-2.0, listed in
`license-report.json`), pinned to a 0.10 release: from 1.0 the package sends usage metrics to Google,
and a test fails if the installed version contains a Google network address. Its WebAssembly files are not committed: the app's `copy-vision` script copies
them from `node_modules` to `app/public/vendor/mediapipe/` at install time, and the `Dockerfile` does
the same in the image.

To replace the model, put the new file here, update `PERCORSO_MODELLO` in
`app/src/lib/live/background-preview.ts` and this page, and check its license before committing it.
