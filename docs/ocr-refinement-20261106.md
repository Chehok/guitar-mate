# 악보 OCR 2차 개선 실측 — 2026-11-06

이 문서는 당시 로컬 스냅샷의 실행 기록입니다. 현재 결과와 최초 main 대비 재현 명령은 [누락 복구 실측](ocr-recovery-20261107.md)을 참고하세요.

평가 10장의 정확 일치는 이전 수정본의 **194→204/318개**, precision은 **89.40→96.68%**, recall은 **61.01→64.15%**로 개선됐습니다. 오인식·불필요한 검출은 줄었지만 누락은 **104→107개**로 늘었으며 평가 이미지 한 장은 일치 수가 감소했습니다.

## 변경과 근거

Tesseract 단독 경로는 작은 임시표와 손글씨 형태의 인쇄 글꼴에서 숫자·m·슬래시 등을 잘못 읽었습니다. 영역 검출 임계값만 바꾼 1차 수정은 평가 성능을 개선하지 못했습니다. 이번에는 무료 공개 사전학습 **PP-OCRv5 영문 영역 인식 모델**을 추가했습니다. 모델 재학습은 하지 않았습니다.

기존 코드 영역을 회색조·이진화·글자 높이 조정의 세 형태로 읽습니다. ONNX Runtime Web 1.20.1의 WASM에서 추론하고, 같은 영역을 Tesseract.js 5.1.1의 두 판독 방식으로 보완합니다. 추가 임시표·접미사는 서로 다른 두 형태 이상에서 최소 세 번 실제로 판독한 문자열일 때만 선택합니다. 키워드 대소문자도 별도로 읽은 문자열을 선택하며 m/M을 같은 것으로 합치지 않습니다. 원시 신뢰도와 보완 근거를 구분해 남깁니다.

새 경로에서는 코드 길이에 큰 가산점을 주거나 다른 영역의 긴 이름으로 일괄 덮어쓰지 않습니다. 조성·음악 이론·곡별 코드 목록은 인식에 사용하지 않습니다. 새 모델을 불러오지 못하면 기존 Tesseract 경로를 사용하고 직접 수정도 계속 가능합니다. 서비스 워커 캐시는 v12입니다.

이미지·코드 문자열을 외부 OCR 서비스로 전송하지 않습니다. jsDelivr와 Hugging Face에서는 공개 런타임·모델 파일만 내려받습니다. 첫 사용에는 기존 도구 외에 약 20MB의 런타임·모델 다운로드가 추가됩니다. 실제 휴대전화의 메모리·인식 시간은 검증하지 못했습니다.

## 데이터와 측정 방식

이번 reviewed 라벨과 동일한 53장 원본 및 HEIC 변환 PNG를 사용했습니다. **개발 42장·1,914개 / 평가 10장·318개 / 보류 1장·80개**의 분리를 유지했습니다. 동일 곡의 다른 조는 같은 분리에 있으며 보류는 사용하지 않았습니다. 사람 확인은 13곳, 실제 문자열 수정은 4곳이고 나머지는 독립 사람 검수 정답이 아닙니다.

비교 기준은 1차 로컬 수정본 `3aa998b`입니다. 이번 개발 후보는 개발 42장으로만 선택했습니다. 이전 평가 집계는 이미 알려진 상태였으나 평가 이미지·오류를 튜닝에 사용하지 않았습니다. 개발 검증 후 코드를 고정하고 평가 10장을 한 번 새로 인식했습니다. 평가를 본 뒤 코드를 다시 조정하지 않았습니다.

전후 모두 같은 이미지·순서·크기 제한·참조 라벨·평가 함수를 사용했습니다. 이번 변경의 대상인 인식 모델과 판독 조합은 달라졌습니다. 각 결과에는 모델·문자 사전·분리·앱 파일의 SHA256을 기록했습니다. 개발 측정 스냅샷과 최종 앱은 OCR 순수 함수가 바이트 단위로 같음을 별도 확인했습니다. UI 연결은 실제 브라우저에서 검사했습니다.

전사 라벨에 좌표가 없으므로 이미지별 행 순서와 OCR 순서를 펼친 LCS로 **정확히 같은 문자열의 발생 수**를 계산합니다. 반복 코드도 매번 세며 대소문자·괄호·슬래시를 그대로 비교합니다. 불일치 구간에서 순서대로 쌍을 이룬 토큰은 오인식, 남은 참조는 누락, 남은 출력은 불필요한 검출입니다. 이 분류는 공간적 매칭이 아니며 반복 주변에서는 정렬의 모호성이 있습니다.

`참조 = 일치 + 오인식 + 누락`, `검출 = 일치 + 오인식 + 불필요한 검출`입니다. Precision=일치/검출, recall=일치/참조, F1=2×일치/(참조+검출)입니다. 모든 결과의 항등식과 별도 Python LCS 계산을 확인했습니다. 최종 수치는 저장 판독의 재처리가 아니라 실제 모델을 실행한 값입니다.

## 실제 결과

| 분리 | 버전 | 참조 | 검출 | 일치 | 누락 | 오인식 | 불필요한 검출 | Precision | Recall | F1 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 개발 42장 | 이전 | 1,914 | 1,642 | 1,387 | 313 | 214 | 41 | 84.47% | 72.47% | 78.01% |
| 개발 42장 | 이번 | 1,914 | 1,651 | 1,532 | 271 | 111 | 8 | 92.79% | 80.04% | 85.95% |
| 평가 10장 | 이전 | 318 | 217 | 194 | 104 | 20 | 3 | 89.40% | 61.01% | 72.52% |
| 평가 10장 | 이번 | 318 | 211 | 204 | 107 | 7 | 0 | 96.68% | 64.15% | 77.13% |

개발 이미지 26장은 일치 수가 늘고 8장은 감소했으며 8장은 같습니다. 평가는 4장 증가·1장 감소·5장 동일합니다. 모든 이미지가 개선된 결과는 아닙니다. 매우 작은 글자, 임시표, 대소문자 및 영역 분리 실패가 남아 있습니다. 처리 시간은 실행 중 자원 경합과 Node/브라우저 실행기의 차이가 있으므로 속도 개선 근거로 사용하지 않습니다.

최초 원격 main `87f8e84`의 개발 결과는 1,358/1,914, 평가 결과는 194/318이었습니다. 원격 main 대비 누적 정확 일치 증가는 개발 174개·평가 10개입니다.

## 검증

- Node 검사 8개 통과: 기존 기능, 영역 인식의 텐서 배치·CTC 중복/blank 처리·사전 검증·문자열 보존·복수 판독 근거. 튜너 1,374개 피치 사례 통과.
- Chromium 360/390/768px에서 탭·JPG/PNG 업로드·수동 수정·카포·반음 이동·표시 모드·PNG 저장·잘못된 이미지 처리·가로 넘침 확인 통과.
- 실제 브라우저 WASM 모델과 실제 Tesseract로 합성 코드 8개 인식, 취소 후 기존 결과 보존 확인.
- 비공개 개발 이미지 한 장은 브라우저에서도 29/31 일치였고 Node 측정과 코드 출력 순서·문자열이 같았습니다. 해당 이미지의 이전 결과는 9/31이었습니다.
- 모델 다운로드를 차단한 실제 브라우저에서 기존 Tesseract로 대체 인식하는 동작 통과.
- 실제 서비스 워커 v12 설치 후 오프라인 재접속·탭 이동·HEIC 변환 PNG(904×1054) 업로드 통과.
- 실제 iOS/Safari·Android 기기, OS 클립보드 권한·길게 누르기, 마이크 입력, 기존 `.ref` 전체 OCR의 별도 재실행은 미검증입니다. 브라우저 모델 검사는 동일 버전의 로컬 자산으로 응답했으며 전체 52장을 브라우저에서 재측정한 것은 아닙니다.

이미지·확대본·전사 라벨·원시 판독·외부 모델 바이너리는 체크아웃 밖에 보관합니다. Git이나 공개 PR 첨부에 포함하지 않습니다. 유료 인식 서비스·Astra·결제 설정 변경·별도 배포는 사용하지 않았습니다.

## 모델과 재현

모델은 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)의 사전학습 모델을 [monkt/paddleocr-onnx](https://huggingface.co/monkt/paddleocr-onnx)에서 ONNX 형식으로 제공한 것입니다. 리비전 `7b02d0a30a07ba2b92ad1ff5a8941ae2c633de65`로 고정했습니다. PaddleOCR는 Apache-2.0, ONNX Runtime은 MIT 라이선스입니다. 앱의 인식 입력은 이 파일에서 실제 확인한 높이 48·RGB NCHW·[-1,1] 정규화이며 문자 사전과 출력 클래스 수를 대조합니다.

- 모델 7,830,888 bytes: SHA256 `4e16deb22c4da6468bdca539b2cd3c8687825538b67109177c47d359ab994cd7`
- 사전 1,416 bytes: SHA256 `e025a66d31f327ba0c232e03f407ae8d105e1e709e7ccb3f408aa778c24e70d6`
- 브라우저: onnxruntime-web 1.20.1, 단일 WASM 스레드. 실측: onnxruntime-node 1.20.1 CPU 단일 스레드. 보완 판독은 모두 Tesseract.js 5.1.1 / eng best_int입니다.

Python 3/Pillow를 준비하고 비공개 데이터와 런타임은 체크아웃 밖에 둡니다. `DATA_ROOT/reviewed`에는 reviewed ZIP의 `split.json`·`labels/`, `DATA_ROOT/extracted`에는 원본, `DATA_ROOT/converted`에는 HEIC의 PNG를 둡니다.

```sh
mkdir -p "$RUN_ROOT" "$OCR_RUNTIME"
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --prefix "$OCR_RUNTIME" tesseract.js@5.1.1 onnxruntime-node@1.20.1 onnxruntime-web@1.20.1 playwright-core@1.58.2
MODEL_BASE=https://huggingface.co/monkt/paddleocr-onnx/resolve/7b02d0a30a07ba2b92ad1ff5a8941ae2c633de65/languages/english
curl -fL "$MODEL_BASE/rec.onnx" -o "$OCR_RUNTIME/rec.onnx"
curl -fL "$MODEL_BASE/dict.txt" -o "$OCR_RUNTIME/dict.txt"
curl -fL https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz -o "$OCR_RUNTIME/eng.traineddata.gz"
gzip -dk "$OCR_RUNTIME/eng.traineddata.gz"
export NODE_PATH="$OCR_RUNTIME/node_modules" OCR_LANG_PATH="$OCR_RUNTIME" OCR_DEBUG=1
git show 3aa998b:index.html > "$RUN_ROOT/previous.html"

for split in development evaluation; do
  OCR_APP_HTML="$RUN_ROOT/previous.html" OCR_REGION_MODEL= node scripts/ocr-dataset.cjs "$DATA_ROOT/reviewed" "$DATA_ROOT" "$split" "$RUN_ROOT/before-$split"
  OCR_REGION_MODEL="$OCR_RUNTIME/rec.onnx" OCR_REGION_DICTIONARY="$OCR_RUNTIME/dict.txt" OCR_REGION_SECONDARY=1 node scripts/ocr-dataset.cjs "$DATA_ROOT/reviewed" "$DATA_ROOT" "$split" "$RUN_ROOT/after-$split"
done
for check in tests/*.cjs; do node "$check" || exit; done
# 별도 터미널에서 같은 체크아웃을 localhost:8765로 제공한 뒤 실행합니다.
OCR_RUNTIME="$OCR_RUNTIME" OCR_REGION_MODEL="$OCR_RUNTIME/rec.onnx" OCR_REGION_DICTIONARY="$OCR_RUNTIME/dict.txt" node tests/browser/score.cjs
```

브라우저 검사에는 `OCR_RUNTIME`을 환경 변수로 전달해야 합니다. 외부 실제 개발 이미지 검사는 `OCR_SAMPLE_IMAGE`와 체크아웃 밖의 `OCR_SAMPLE_REPORT` 경로를 선택적으로 지정합니다. 원시 JSON은 비공개 전사를 포함하므로 공개하지 마세요.
