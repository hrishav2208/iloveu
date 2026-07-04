export class HandTracker {
    constructor(videoElement, onGesture, onSmile) {
        this.videoElement = videoElement;
        this.onGesture = onGesture;
        this.onSmile = onSmile;

        this.skeletonCanvas = document.getElementById('skeleton-canvas');
        this.skeletonCtx = this.skeletonCanvas ? this.skeletonCanvas.getContext('2d') : null;
        
        this.lastHandPos = null;
        this.lastTwoHandDist = null;

        // Heart image for landmark dots
        this.heartImg = new Image();
        this.heartImg.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23FFD1DC' d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'/%3E%3C/svg%3E";

        this.hands = new window.Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        this.hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.7
        });

        this.hands.onResults(this.onResults.bind(this));

        // Initialize FaceMesh for smile detection
        this._faceFrameCount = 0; // throttle face processing
        if (window.FaceMesh) {
            this.faceMesh = new window.FaceMesh({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
            });
            this.faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: false,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            this.faceMesh.onResults(this.onFaceResults.bind(this));
        }

        this.camera = new window.Camera(this.videoElement, {
            onFrame: async () => {
                await this.hands.send({ image: this.videoElement });
                // Only run face mesh every 6th frame to avoid blocking hand detection
                this._faceFrameCount++;
                if (this.faceMesh && this._faceFrameCount % 6 === 0) {
                    await this.faceMesh.send({ image: this.videoElement });
                }
            },
            width: 640,
            height: 480
        });
    }

    start() {
        return this.camera.start();
    }

    drawSkeleton(results) {
        if (!this.skeletonCtx || !this.skeletonCanvas) return;

        const ctx = this.skeletonCtx;
        const cw = this.skeletonCanvas.width;
        const ch = this.skeletonCanvas.height;

        ctx.clearRect(0, 0, cw, ch);

        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) return;

        for (const landmarks of results.multiHandLandmarks) {
            // Scale normalized landmarks to canvas pixels (mirror X)
            const pts = landmarks.map(p => ({
                x: (1 - p.x) * cw,
                y: p.y * ch
            }));

            // Draw connections (bone lines) manually for full control
            const connections = window.HAND_CONNECTIONS;
            ctx.strokeStyle = '#FFD1DC';
            ctx.lineWidth = 2.5;
            ctx.shadowBlur = 6;
            ctx.shadowColor = '#FFB6C1';
            ctx.beginPath();
            for (const [a, b] of connections) {
                ctx.moveTo(pts[a].x, pts[a].y);
                ctx.lineTo(pts[b].x, pts[b].y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Draw baby pink heart at every joint
            const hSize = 10;
            for (const pt of pts) {
                if (this.heartImg.complete) {
                    ctx.drawImage(this.heartImg, pt.x - hSize / 2, pt.y - hSize / 2, hSize, hSize);
                } else {
                    // Fallback circle while image loads
                    ctx.fillStyle = '#FFD1DC';
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }

    onResults(results) {
        this.drawSkeleton(results);

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {

            // TWO HANDS — but detect if it's a pinch-drag (both hands pinching)
            if (results.multiHandLandmarks.length >= 2) {
                const landmarks0 = results.multiHandLandmarks[0];
                const landmarks1 = results.multiHandLandmarks[1];
                let hand1Pos = landmarks0[9];
                let hand2Pos = landmarks1[9];

                // Check if both hands are pinching (thumb-index distance on each)
                // Relaxed distance so it's easier to trigger simultaneously
                const pinchDist0 = this.getDist(landmarks0[4], landmarks0[8]);
                const pinchDist1 = this.getDist(landmarks1[4], landmarks1[8]);
                const bothPinching = pinchDist0 < 0.08 && pinchDist1 < 0.08;

                if (bothPinching) {
                    // Two-pinch drag: magic wand mode
                    const centerX = (hand1Pos.x + hand2Pos.x) / 2;
                    const centerY = (hand1Pos.y + hand2Pos.y) / 2;

                    let deltaX = 0, deltaY = 0;
                    if (this.lastHandPos) {
                        deltaX = centerX - this.lastHandPos.x;
                        deltaY = centerY - this.lastHandPos.y;
                    }
                    this.lastHandPos = { x: centerX, y: centerY };

                    if (this.onGesture) {
                        this.onGesture({
                            type: 'magic_wand',
                            position: hand1Pos,
                            position2: hand2Pos,
                            centerX,
                            centerY
                        });
                    }
                    return;
                }

                // Otherwise standard two-hand zoom
                const rawHand1Pos = landmarks0[9];
                const rawHand2Pos = landmarks1[9];

                if (!this.smoothedPos1 || !this.smoothedPos2) {
                    this.smoothedPos1 = { x: rawHand1Pos.x, y: rawHand1Pos.y, z: rawHand1Pos.z };
                    this.smoothedPos2 = { x: rawHand2Pos.x, y: rawHand2Pos.y, z: rawHand2Pos.z };
                } else {
                    const alpha = 0.3;
                    this.smoothedPos1.x += (rawHand1Pos.x - this.smoothedPos1.x) * alpha;
                    this.smoothedPos1.y += (rawHand1Pos.y - this.smoothedPos1.y) * alpha;
                    this.smoothedPos2.x += (rawHand2Pos.x - this.smoothedPos2.x) * alpha;
                    this.smoothedPos2.y += (rawHand2Pos.y - this.smoothedPos2.y) * alpha;
                }
                hand1Pos = this.smoothedPos1;
                hand2Pos = this.smoothedPos2;

                const dist = this.getDist(hand1Pos, hand2Pos);
                let zoomDelta = 0;
                if (this.lastTwoHandDist !== null) {
                    zoomDelta = dist - this.lastTwoHandDist;
                }
                this.lastTwoHandDist = dist;

                if (this.onGesture) {
                    this.onGesture({
                        type: 'two_hands_zoom',
                        zoomDelta,
                        position: hand1Pos,
                        position2: hand2Pos
                    });
                }
                return;
            }

            // SINGLE HAND
            this.lastTwoHandDist = null;
            this.smoothedPos1 = null;
            this.smoothedPos2 = null;
            const landmarks = results.multiHandLandmarks[0];
            const handedness = results.multiHandedness[0].label;

            const gesture = this.detectGesture(landmarks, handedness);
            const rawPos = landmarks[9];

            if (!this.smoothedPos) {
                this.smoothedPos = { x: rawPos.x, y: rawPos.y, z: rawPos.z };
            } else {
                const alpha = 0.3; // Smoothing factor to remove jitter
                this.smoothedPos.x += (rawPos.x - this.smoothedPos.x) * alpha;
                this.smoothedPos.y += (rawPos.y - this.smoothedPos.y) * alpha;
                this.smoothedPos.z += (rawPos.z - this.smoothedPos.z) * alpha;
            }
            
            const currentPos = this.smoothedPos;

            let deltaX = 0, deltaY = 0;
            if (this.lastHandPos) {
                deltaX = currentPos.x - this.lastHandPos.x;
                deltaY = currentPos.y - this.lastHandPos.y;
                
                // Deadzone to prevent micro-jitter
                if (Math.abs(deltaX) < 0.001) deltaX = 0;
                if (Math.abs(deltaY) < 0.001) deltaY = 0;
            }
            this.lastHandPos = { x: currentPos.x, y: currentPos.y, z: currentPos.z };

            if (this.onGesture) {
                this.onGesture({
                    type: gesture,
                    landmarks,
                    position: currentPos,
                    deltaX,
                    deltaY
                });
            }
        } else {
            this.lastHandPos = null;
            this.smoothedPos = null;
            this.smoothedPos1 = null;
            this.smoothedPos2 = null;
            this.lastTwoHandDist = null;
            if (this.onGesture) {
                this.onGesture({ type: 'none', landmarks: null });
            }
        }
    }

    onFaceResults(results) {
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const face = results.multiFaceLandmarks[0];
            
            // 61: left mouth corner, 291: right mouth corner
            // 234: left cheek edge, 454: right cheek edge
            const mouthWidth = this.getDist(face[61], face[291]);
            const faceWidth = this.getDist(face[234], face[454]);
            
            const ratio = mouthWidth / faceWidth;
            
            // Typical ratio is ~0.35 relaxed, > 0.40 when smiling widely
            // Fire dedicated onSmile callback — never touches hand gesture pipeline
            if (ratio > 0.41 && this.onSmile) {
                this.onSmile(ratio);
            }
        }
    }

    getDist(p1, p2) {
        return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
    }

    detectGesture(landmarks, handedness) {
        const thumbTip  = landmarks[4];
        const indexTip  = landmarks[8];
        const indexPip  = landmarks[6];
        const indexMcp  = landmarks[5];
        const middleTip = landmarks[12];
        const middlePip = landmarks[10];
        const ringTip   = landmarks[16];
        const ringPip   = landmarks[14];
        const pinkyTip  = landmarks[20];
        const pinkyPip  = landmarks[18];
        const wrist     = landmarks[0];

        const isIndexExt  = this.getDist(wrist, indexTip)  > this.getDist(wrist, indexPip);
        const isMiddleExt = this.getDist(wrist, middleTip) > this.getDist(wrist, middlePip);
        const isRingExt   = this.getDist(wrist, ringTip)   > this.getDist(wrist, ringPip);
        const isPinkyExt  = this.getDist(wrist, pinkyTip)  > this.getDist(wrist, pinkyPip);

        let isThumbExt = handedness === 'Right'
            ? thumbTip.x < indexMcp.x
            : thumbTip.x > indexMcp.x;

        // Pinch first — before checking fist (thumb+index close)
        const pinchDist = this.getDist(thumbTip, indexTip);
        
        // OK Sign (Pinch but other fingers are extended)
        if (pinchDist < 0.05 && isMiddleExt && isRingExt && isPinkyExt) {
            return 'ok_sign';
        }

        // Standard Pinch
        if (pinchDist < 0.05 && !isMiddleExt && !isRingExt && !isPinkyExt) {
            return 'pinch';
        }

        // Fist
        if (!isThumbExt && !isIndexExt && !isMiddleExt && !isRingExt && !isPinkyExt) {
            return 'fist';
        }

        // Open palm
        if (isThumbExt && isIndexExt && isMiddleExt && isRingExt && isPinkyExt) {
            return 'open_palm';
        }

        // Four Fingers (all but thumb)
        if (!isThumbExt && isIndexExt && isMiddleExt && isRingExt && isPinkyExt) {
            return 'four_fingers';
        }

        // Point Up / Down
        if (!isThumbExt && isIndexExt && !isMiddleExt && !isRingExt && !isPinkyExt) {
            if (indexTip.y < indexMcp.y) return 'point_up';
            return 'point_down';
        }

        // Thumbs Up / Down (only thumb extended)
        if (isThumbExt && !isIndexExt && !isMiddleExt && !isRingExt && !isPinkyExt) {
            if (thumbTip.y < landmarks[2].y) return 'thumbs_up'; // 2 is thumb CMC
            return 'thumbs_down';
        }

        // Peace
        if (!isThumbExt && isIndexExt && isMiddleExt && !isRingExt && !isPinkyExt) {
            return 'peace';
        }

        // Call Me / Shaka
        if (isThumbExt && !isIndexExt && !isMiddleExt && !isRingExt && isPinkyExt) {
            return 'call_me';
        }

        // I Love You
        if (isThumbExt && isIndexExt && !isMiddleExt && !isRingExt && isPinkyExt) {
            return 'love';
        }

        return 'none';
    }
}
