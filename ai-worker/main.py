# pyrefly: ignore [missing-import]
"""
HRM AI Worker - Face extraction microservice.

Stack:
    - YOLOv8-face (ultralytics) for face detection (fast, real-time)
    - InsightFace ArcFace (buffalo_l) for 512-d face embeddings
    - FastAPI for HTTP API
    - Cosine distance computed by the caller (backend) using pgvector

Endpoints:
    GET  /health                    - service health + model status
    POST /extract_faces             - multipart "files": one or many images
                                     returns {status, data: [{bounding_box, embedding}]}
"""
import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from typing import List
import torch

# Patch torch.load for PyTorch >=2.6 strictness
original_load = torch.load
def safe_load(*args, **kwargs):
    kwargs["weights_only"] = False
    return original_load(*args, **kwargs)
torch.load = safe_load

from ultralytics import YOLO
import insightface
from insightface.app import FaceAnalysis
from fastapi.middleware.cors import CORSMiddleware
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ai-worker")

app = FastAPI(title="HRM AI Face Extraction")

# CORS - allow all (caller is internal network only)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----- Load YOLO model -----
yolo_model = None
try:
    model_path = os.environ.get("YOLO_MODEL_PATH", "yolov8n-face.pt")
    if not os.path.exists(model_path):
        log.warning(f"YOLO model not found at {model_path}; face detection will be skipped")
    yolo_model = YOLO(model_path)
    log.info("YOLO model loaded")
except Exception as e:
    log.error(f"Failed to load YOLO: {e}")

# ----- Load InsightFace (buffalo_l) -----
app_face = None
try:
    app_face = FaceAnalysis(
        name="buffalo_l",
        root="./models",
        providers=["CPUExecutionProvider"],
    )
    app_face.prepare(ctx_id=0, det_size=(640, 640))
    log.info("InsightFace (buffalo_l) loaded")
except Exception as e:
    log.error(f"Failed to load InsightFace: {e}")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "yolo_loaded": yolo_model is not None,
        "insightface_loaded": app_face is not None,
    }


@app.post("/extract_faces")
async def extract_faces(files: List[UploadFile] = File(...)):
    if app_face is None:
        raise HTTPException(status_code=500, detail="AI models not loaded")

    results_data = []

    for file in files:
        try:
            contents = await file.read()
            nparr = np.frombuffer(contents, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                continue

            # InsightFace on the whole image (RetinaFace inside buffalo_l)
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            insight_faces = app_face.get(img_rgb)

            if yolo_model is not None:
                # YOLO for face detection boxes
                results = yolo_model(img)[0]

                for box in results.boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                    w = x2 - x1
                    h = y2 - y1
                    yolo_cx = (x1 + x2) / 2
                    yolo_cy = (y1 + y2) / 2

                    # Match YOLO box to nearest InsightFace by center containment
                    best = None
                    for face in insight_faces:
                        fx1, fy1, fx2, fy2 = face.bbox
                        if fx1 <= yolo_cx <= fx2 and fy1 <= yolo_cy <= fy2:
                            best = face
                            break
                    if best is None and len(insight_faces) > 0:
                        best = insight_faces[0]

                    if best is not None:
                        embedding = best.embedding.tolist()
                        results_data.append({
                            "bounding_box": {"x": int(x1), "y": int(y1), "w": int(w), "h": int(h)},
                            "embedding": embedding,
                        })
            else:
                for face in insight_faces:
                    fx1, fy1, fx2, fy2 = face.bbox
                    w = int(fx2 - fx1)
                    h = int(fy2 - fy1)
                    embedding = face.embedding.tolist()
                    results_data.append({
                        "bounding_box": {"x": int(fx1), "y": int(fy1), "w": w, "h": h},
                        "embedding": embedding,
                    })
        except Exception as e:
            log.exception(f"Error processing {file.filename}: {e}")
            continue

    return {"status": "success", "data": results_data}
