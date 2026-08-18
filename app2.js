// DOMの読み込みが完了したらスクリプトを実行
document.addEventListener('DOMContentLoaded', () => {

    const canvas = document.getElementById('simulationCanvas');
    if (!canvas.getContext) return;
    const ctx = canvas.getContext('2d');

    // --- 設定 ---
    const SCREEN_WIDTH = canvas.width;
    const SCREEN_HEIGHT = canvas.height;
    const GRAVITY_ACCELERATION = 10;
    const FLOOR_HEIGHT = 200;
    const FLOOR_COLOR = 'rgb(230, 230, 230)'; 
    const floorRect = { x: 0, y: SCREEN_HEIGHT - FLOOR_HEIGHT, width: SCREEN_WIDTH, height: FLOOR_HEIGHT };
    const VECTOR_WIDTH = 2;
    const VECTOR_COLORS = ['#000000']; 
    const FORCE_SCALE_FACTOR = 0.1;

    // --- ボタン設定 (3つ並べる) ---
    const buttonWidth = 100, buttonHeight = 40;
    const buttonGap = 50; // ボタン間の隙間
    
    // 3つのボタン全体の幅
    const totalButtonWidth = (buttonWidth * 3) + (buttonGap * 2);
    // 左端の開始位置
    const startButtonBaseX = (SCREEN_WIDTH - totalButtonWidth) / 2;
    const buttonY = SCREEN_HEIGHT - buttonHeight - 20;

    // 各ボタンの矩形定義
    const startButtonRect = { x: startButtonBaseX, y: buttonY, width: buttonWidth, height: buttonHeight };
    const undoButtonRect  = { x: startButtonBaseX + buttonWidth + buttonGap, y: buttonY, width: buttonWidth, height: buttonHeight };
    const resetButtonRect = { x: startButtonBaseX + (buttonWidth + buttonGap) * 2, y: buttonY, width: buttonWidth, height: buttonHeight };
    
    const START_BUTTON_COLOR_IDLE = '#90EE90'; 
    const UNDO_BUTTON_COLOR_IDLE  = '#FFD700'; // 黄色
    const RESET_BUTTON_COLOR_IDLE = '#ADD8E6'; 
    const BUTTON_FONT = "bold 18px 'Meiryo', sans-serif";
    const INSTRUCTION_FONT = "16px 'Meiryo', sans-serif";

    // --- ★ログ設定（ここに入力してください） ---
    const ACTION_LOG_URL = ""; 
    const APP_ID = 2;

    // --- 正解データ ---
    const CORRECT_ANSWERS = [
        {
            objectId: 'box1', 
            vectors: [
                { name: "重力", fx: 0, fy: 15, startPosType: 'center' }, 
                { name: "床からの垂直抗力", fx: 0, fy: -15, startPosType: 'bottom+12,-5' }, 
            ]
        }
    ];

    // --- 変数 ---
    let isRunning = false;
    let isDrawingVector = false;
    let vectorStartPos = null;
    let currentMousePos = { x: 0, y: 0 };
    let targetObject = null; 
    let validationTimer = null;

    let box1;
    let box1Vectors = [];
    let forceTextStamps = [];
    let calculatedMass1 = 0.0;
    let currentAttemptDataURL = null; 
    let previousAttemptImage = null;
    let showMassText = false;

    // --- クラス ---
    class PhysicsObject {
        constructor(x, y, w, h, m, c) {
            this.x = x; this.y = y; this.width = w; this.height = h;
            this.mass = m; this.color = c;
            this.vx = 0; this.vy = 0; this.ax = 0; this.ay = 0;
            this.initialRect = { x: x, y: y, width: w, height: h };
        }
        update() { this.vx += this.ax; this.vy += this.ay; this.x += this.vx; this.y += this.vy; }
        draw(ctx) {
            ctx.fillStyle = this.color; ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.strokeStyle = 'black'; ctx.lineWidth = 1; ctx.strokeRect(this.x, this.y, this.width, this.height);
        }
        collidesWith(p) {
            return p.x >= this.initialRect.x && p.x <= this.initialRect.x + this.initialRect.width &&
                   p.y >= this.initialRect.y && p.y <= this.initialRect.y + this.initialRect.height;
        }
    }
    class ForceVector {
        constructor(startPos, vx, vy, color) { this.startPos = startPos; this.vx = vx; this.vy = vy; this.color = color; }
        draw(ctx, offsetX = 0, offsetY = 0) {
            ctx.strokeStyle = this.color; ctx.lineWidth = VECTOR_WIDTH;
            drawVector(ctx, this.startPos.x + offsetX, this.startPos.y + offsetY, this.startPos.x + this.vx + offsetX, this.startPos.y + this.vy + offsetY);
        }
    }
    class ForceText {
        constructor(text, pos) { this.text = text; this.pos = pos; }
        draw(ctx) { ctx.fillStyle = 'black'; ctx.font = BUTTON_FONT; ctx.fillText(this.text, this.pos.x, this.pos.y); }
    }

    // --- 関数 ---
    // カスタムアラート関数（画面を暗くしない） 
    function showCustomAlert(msg, callback) {
        const existing = document.getElementById('customAlert');
        if (existing) existing.remove();

        const alertDiv = document.createElement('div');
        alertDiv.id = 'customAlert';
        alertDiv.style.position = 'fixed';
        alertDiv.style.top = '20px'; 
        alertDiv.style.left = '50%';
        alertDiv.style.transform = 'translateX(-50%)';
        alertDiv.style.backgroundColor = 'white';
        alertDiv.style.border = '2px solid #ff6666';
        alertDiv.style.borderRadius = '8px';
        alertDiv.style.padding = '15px 30px';
        alertDiv.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
        alertDiv.style.zIndex = '2000';
        alertDiv.style.textAlign = 'center';
        alertDiv.style.fontFamily = BUTTON_FONT;
        alertDiv.style.color = '#333';

        const textDiv = document.createElement('div');
        textDiv.innerHTML = msg.replace(/\n/g, '<br>');
        textDiv.style.marginBottom = '15px';
        textDiv.style.fontSize = '16px';
        alertDiv.appendChild(textDiv);

        const btn = document.createElement('button');
        btn.innerText = "OK";
        btn.style.padding = '8px 25px';
        btn.style.fontSize = '16px';
        btn.style.cursor = 'pointer';
        btn.style.backgroundColor = '#ff6666';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '5px';
        btn.onclick = () => {
            alertDiv.remove();
            if (callback) callback(); 
        };
        alertDiv.appendChild(btn);

        document.body.appendChild(alertDiv);
    } 
    // オブジェクト状態の初期化
    function createObjectStates(needLog = true) {
        try {
            if (needLog && box1Vectors && box1Vectors.length > 0) {
                sendActionLog(0); 
            }
        } catch (e) { console.error(e); }

        if (validationTimer) clearTimeout(validationTimer);
        const box1Width = 120, box1Height = 120, box1Mass = 1.5;
        const box1InitialX = SCREEN_WIDTH / 2.0 - box1Width / 2.0;
        const box1InitialY = floorRect.y - box1Height;
        box1 = new PhysicsObject(box1InitialX, box1InitialY, box1Width, box1Height, box1Mass, 'rgb(100, 255, 100)');
        
        isRunning = false;
        box1Vectors = []; forceTextStamps = [];
        showMassText = false;
        calculatedMass1 = 0.0;
        targetObject = null;
    }

    // ★ 1つ戻る処理
    function undoLastAction() {
        if (box1Vectors.length === 0) return; // 矢印がなければ何もしない

        // ログ送信 (タイプ2: 戻る)
        try {
            sendActionLog(2);
        } catch (e) {
            console.error("Log error:", e);
        }

        box1Vectors.pop();     // 最後の矢印を削除
        forceTextStamps.pop(); // 対応するテキストも削除
    }

    function startSimulation() {
        if (isRunning) return;
        
        // 合わせ鏡を防ぎつつ作図状態を保存
        const tempImg = previousAttemptImage; 
        previousAttemptImage = null;          
        drawSimulation();                     
        currentAttemptDataURL = canvas.toDataURL(); 
        previousAttemptImage = tempImg;
        
        try { sendActionLog(1); } catch (e) { console.error(e); }

        const netForceVX1 = box1Vectors.reduce((sum, v) => sum + v.vx, 0);
        let netForceVY1 = box1Vectors.reduce((sum, v) => sum + v.vy, 0);
        let downwardVectors1 = box1Vectors.filter(v => v.vy > 0).reduce((sum, v) => sum + v.vy, 0);
        let upwardVectors1 = box1Vectors.filter(v => v.vy < 0).reduce((sum, v) => sum + v.vy, 0);
        
        let netForceN_VX1 = netForceVX1 * FORCE_SCALE_FACTOR;
        let netForceN_VY1 = netForceVY1 * FORCE_SCALE_FACTOR;
        
        // 質量計算用の変数
        let netupwardVectors1 = upwardVectors1 * FORCE_SCALE_FACTOR; 
        
        let netForceN_VY1_pygame = -netForceN_VY1;

        box1.ax = (netForceN_VX1 * FORCE_SCALE_FACTOR) / box1.mass;
        box1.ay = (netForceN_VY1 * FORCE_SCALE_FACTOR) / box1.mass;

        if (Math.abs(netForceN_VX1) < 0.09 && Math.abs(netForceN_VY1) < 0.09) { box1.ax = 0; box1.ay = 0; }

        if (netForceN_VY1_pygame < 0) {
            calculatedMass1 = -1 * netupwardVectors1 / GRAVITY_ACCELERATION;
        } else if (netForceN_VY1_pygame >= 0 && netForceN_VY1_pygame < 0.09) {
            calculatedMass1 = -1 * netupwardVectors1 / GRAVITY_ACCELERATION;
        } else {
            calculatedMass1 = 0;
        }
        
        showMassText = true;
        isRunning = true;

        if (validationTimer) clearTimeout(validationTimer);
        
        validationTimer = setTimeout(() => {
            const isCorrect = checkAnswer(); 
            if (!isCorrect) {
                isRunning = false;
                createObjectStates(false); // 不正解ならリセット(ログなし)
            }
        }, 1000); 
    }

    function updateSimulation() {
        if (!isRunning) return;
        box1.update();
    }
   
    function drawSimulation() {
        ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        const userName = sessionStorage.getItem('physics_app_username') || "ゲスト";
        ctx.fillStyle = '#555'; ctx.font = "14px 'Meiryo', sans-serif"; ctx.textAlign = "right";
        ctx.fillText(`学習者: ${userName}`, SCREEN_WIDTH - 20, 30); ctx.textAlign = "left"; 
        ctx.fillStyle = FLOOR_COLOR; ctx.fillRect(floorRect.x, floorRect.y, floorRect.width, floorRect.height);
        ctx.fillStyle = 'black'; ctx.font = INSTRUCTION_FONT;
        ctx.fillText("質量1.5kgの緑色の物体にはたらく力を作図して再生ボタンを押してみましょう。", 10, 25);
        ctx.fillText("100gの物体にはたらく力の大きさを1.0Nとする。また、灰色の床ははかりになっている。", 10, 45);

        box1.draw(ctx);

        const startPosCounts = {}; 
        const drawWithOffset = (vectorList) => {
            vectorList.forEach(v => {
                const key = `${v.startPos.x},${v.startPos.y}`;
                const count = startPosCounts[key] || 0;
                let offset = 0;
                if (count > 0) {
                    const gap = 12; const sign = (count % 2 === 1) ? 1 : -1;
                    const multiplier = Math.ceil(count / 2.0);
                    offset = multiplier * gap * sign;
                }
                v.draw(ctx, offset, 0); startPosCounts[key] = count + 1;
            });
        };
        drawWithOffset(box1Vectors);
     
        if (isDrawingVector && vectorStartPos) {
            const snappedComponents = snapVectorComponents(vectorStartPos, currentMousePos);
            const snappedEndPosX = vectorStartPos.x + snappedComponents.vx;
            const snappedEndPosY = vectorStartPos.y + snappedComponents.vy;
            ctx.strokeStyle = VECTOR_COLORS[0]; ctx.lineWidth = VECTOR_WIDTH;
            drawVector(ctx, vectorStartPos.x, vectorStartPos.y, snappedEndPosX, snappedEndPosY);
            const mag = Math.sqrt(snappedComponents.vx**2 + snappedComponents.vy**2) * FORCE_SCALE_FACTOR;
            ctx.fillStyle = 'black'; ctx.font = BUTTON_FONT;
            ctx.fillText(`${mag.toFixed(1)} N`, snappedEndPosX + 50, snappedEndPosY -20);
        }
        forceTextStamps.forEach(t => t.draw(ctx));
        if (showMassText) {
            ctx.font = BUTTON_FONT; ctx.fillStyle = 'black'; 
            ctx.fillText(`灰色の床がはかる重さ: ${calculatedMass1.toFixed(2)} kg`, 10, 390);
        }
        
        // 3つのボタンを描画
        drawButton(ctx, startButtonRect, START_BUTTON_COLOR_IDLE, "再生");
        drawButton(ctx, undoButtonRect,  UNDO_BUTTON_COLOR_IDLE,  "1つ戻る");
        drawButton(ctx, resetButtonRect, RESET_BUTTON_COLOR_IDLE, "リセット");

        // ★ 追加：直前の作図スクリーンショットを表示
        if (previousAttemptImage) {
            const scale = 0.37; // 縮小表示
            const w = SCREEN_WIDTH * scale;
            const h = SCREEN_HEIGHT * scale;
            const x = SCREEN_WIDTH - w - 10; 
            const y = 150; 

            ctx.drawImage(previousAttemptImage, x, y, w, h);
            ctx.strokeStyle = '#ff0000'; // 赤枠で目立たせる
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);

            ctx.fillStyle = 'red';
            ctx.font = "bold 14px 'Meiryo', sans-serif";
            ctx.fillText("直前の作図", x+35, y - 10);
        }
    }

    // --- ヘルパー関数群 ---
    function getSnapPoints(box) {
        const rect = box.initialRect; const cx = rect.x + rect.width / 2; const cy = rect.y + rect.height / 2;
        return [{ x: cx, y: cy }, { x: cx-12, y: rect.y+5 }, { x: cx+12, y: rect.y + rect.height -5}, { x: rect.x+5, y: cy }, { x: rect.x + rect.width-5, y: cy }];
    }
    function getNearestSnapPoint(p, box) {
        const snapPoints = getSnapPoints(box);
        let minDistance = Infinity; let nearestPoint = null;
        for (const sp of snapPoints) {
            const dist = getDistance(p, sp);
            if (dist < minDistance) { minDistance = dist; nearestPoint = sp; }
        } return nearestPoint;
    }
    function drawVector(ctx, x1, y1, x2, y2) {
        if (x1 === x2 && y1 === y2) return;
        ctx.beginPath(); ctx.arc(x1, y1, 4, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        const angle = Math.atan2(y2 - y1, x2 - x1); const arrowheadLength = 10;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - arrowheadLength * Math.cos(angle - Math.PI / 6), y2 - arrowheadLength * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - arrowheadLength * Math.cos(angle + Math.PI / 6), y2 - arrowheadLength * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    }
    function drawButton(ctx, rect, color, text) {
        ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.width, rect.height, [5]); ctx.fill();
        ctx.fillStyle = 'black'; ctx.font = BUTTON_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2);
    }
    function snapVectorComponents(start, end) {
        const vx = end.x - start.x; const vy = end.y - start.y;
        if (vx === 0 && vy === 0) return { vx: 0, vy: 0 };
        const angleRad = Math.atan2(vy, vx); const magnitude = Math.sqrt(vx * vx + vy * vy);
        const snappedMagnitude = (Math.round((magnitude * FORCE_SCALE_FACTOR) / 0.5) * 0.5) / FORCE_SCALE_FACTOR;
        const snapAngle = Math.PI / 6.0; const snappedAngleRad = Math.round(angleRad / snapAngle) * snapAngle;
        return { vx: snappedMagnitude * Math.cos(snappedAngleRad), vy: snappedMagnitude * Math.sin(snappedAngleRad) };
    }
    function getDistance(p1, p2) { return Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2); }
    function isPointInRect(p, rect) { return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height; }
    function getPos(e) {
        const rect = canvas.getBoundingClientRect(); let clientX, clientY;
        if (e.touches && e.touches.length > 0) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; } 
        else if (e.changedTouches && e.changedTouches.length > 0) { clientX = e.changedTouches[0].clientX; clientY = e.changedTouches[0].clientY; } 
        else { clientX = e.clientX; clientY = e.clientY; }
        return { x: clientX - rect.left, y: clientY - rect.top };
    }
    function getTargetPos(box, typeString) {
        const r = box.initialRect; const cx = r.x + r.width / 2; const cy = r.y + r.height / 2;
        let type = typeString; let offsetX = 0; let offsetY = 0;
        const match = typeString.match(/^([a-z]+)(.*)$/);
        if (match) {
            type = match[1]; const offsetPart = match[2];
            if (offsetPart) {
                if (offsetPart.includes(',')) { const parts = offsetPart.split(','); offsetX = parseInt(parts[0], 10) || 0; offsetY = parseInt(parts[1], 10) || 0; } 
                else { offsetY = parseInt(offsetPart, 10) || 0; }
            }
        }
        let basePos = { x: cx, y: cy };
        switch (type) {
            case 'center': basePos = { x: cx, y: cy }; break; case 'top': basePos = { x: cx, y: r.y }; break;
            case 'bottom': basePos = { x: cx, y: r.y + r.height }; break; case 'left': basePos = { x: r.x, y: cy }; break;
            case 'right': basePos = { x: r.x + r.width, y: cy }; break; default: basePos = { x: cx, y: cy }; break;
        } return { x: basePos.x + offsetX, y: basePos.y + offsetY };
    }

    // --- イベントリスナー ---
    function handleStart(e) {
        e.preventDefault(); const p = getPos(e); currentMousePos = p; targetObject = null; isDrawingVector = false;
        if (isPointInRect(p, startButtonRect)) { startSimulation(); } 
        else if (isPointInRect(p, undoButtonRect)) { undoLastAction(); } // 戻る
        else if (isPointInRect(p, resetButtonRect)) { createObjectStates(); } 
        else if (box1.collidesWith(p)) { isDrawingVector = true; targetObject = box1; vectorStartPos = getNearestSnapPoint(p, box1); } 
    }
    function handleEnd(e) {
        e.preventDefault();
        if (!isDrawingVector || !targetObject) { isDrawingVector = false; targetObject = null; return; }
        isDrawingVector = false; const endPos = getPos(e);
        const snappedComponents = snapVectorComponents(vectorStartPos, endPos);
        if (Math.abs(snappedComponents.vx) < 0.1 && Math.abs(snappedComponents.vy) < 0.1) { targetObject = null; return; }
        const color = VECTOR_COLORS[0];
        const snappedMagnitude = Math.sqrt(snappedComponents.vx**2 + snappedComponents.vy**2);
        const magText = `${(snappedMagnitude * FORCE_SCALE_FACTOR).toFixed(1)} N`;
        const snappedEndPosX = vectorStartPos.x + snappedComponents.vx;
        const snappedEndPosY = vectorStartPos.y + snappedComponents.vy;
        forceTextStamps.push(new ForceText(magText, { x: snappedEndPosX + 15, y: snappedEndPosY + 15 }));
        if (targetObject === box1) { box1Vectors.push(new ForceVector(vectorStartPos, snappedComponents.vx, snappedComponents.vy, color)); } 
        targetObject = null;
    }
    function handleMove(e) {
        e.preventDefault(); currentMousePos = getPos(e); const p = currentMousePos;
        if (isPointInRect(p, startButtonRect) || isPointInRect(p, undoButtonRect) || isPointInRect(p, resetButtonRect)) { 
            canvas.style.cursor = 'pointer'; 
        } else { canvas.style.cursor = 'crosshair'; }
    }
    canvas.addEventListener('mousedown', handleStart, { passive: false }); canvas.addEventListener('touchstart', handleStart, { passive: false });
    canvas.addEventListener('mouseup', handleEnd, { passive: false }); canvas.addEventListener('touchend', handleEnd, { passive: false });
    canvas.addEventListener('mousemove', handleMove, { passive: false }); canvas.addEventListener('touchmove', handleMove, { passive: false });

// --- 正誤判定と誤概念スキャン ---
    function checkAnswer() {
        let allCorrect = true;
        CORRECT_ANSWERS.forEach(answerSet => {
            let userVectors = []; let targetBox = null;
            if (answerSet.objectId === 'box1') { userVectors = box1Vectors; targetBox = box1; } 
            
            if (userVectors.length !== answerSet.vectors.length) { 
                allCorrect = false; 
            }
            
            let remainingUserVectors = [...userVectors];
            answerSet.vectors.forEach(correctVec => {
                const correctStartPos = getTargetPos(targetBox, correctVec.startPosType);
                const foundIndex = remainingUserVectors.findIndex(uVec => {
                    const uFx_N = uVec.vx * FORCE_SCALE_FACTOR; const uFy_N = uVec.vy * FORCE_SCALE_FACTOR;
                    return Math.abs(uFx_N - correctVec.fx) < 0.2 && 
                           Math.abs(uFy_N - correctVec.fy) < 0.2 && 
                           Math.abs(uVec.startPos.x - correctStartPos.x) < 5.0 && 
                           Math.abs(uVec.startPos.y - correctStartPos.y) < 5.0;
                });
                if (foundIndex !== -1) { 
                    remainingUserVectors.splice(foundIndex, 1); 
                } else { 
                    allCorrect = false; 
                }
            });
        });

        if (allCorrect) { 
            generalErrorCount = 0; // 正解したらリセット
            // ★ alert を showCustomAlert に変更
            showCustomAlert("正解です！次の補助問題に移行します。", () => {
                window.location.href = "index3.html"; 
            });
            return true; 
        } else { 
            const userVectors = box1Vectors;

            // ★ 追加：不正解が確定したので、一時保存したスクショを「前回作図」としてセット
            if (currentAttemptDataURL) {
                previousAttemptImage = new Image();
                previousAttemptImage.src = currentAttemptDataURL;
            }
            
            // --- ★誤概念の診断・専用フィードバックロジック ---

            const centerPos = getTargetPos(box1, 'center');
            const bottomPos = getTargetPos(box1, 'bottom');
            
            // 【パターン1の判定】
            const hasCorrectGravity = userVectors.some(v => {
                const uFx = v.vx * FORCE_SCALE_FACTOR;
                const uFy = v.vy * FORCE_SCALE_FACTOR;
                return Math.abs(uFx - 0) < 0.2 && Math.abs(uFy - 15) < 0.2 &&
                       Math.abs(v.startPos.x - centerPos.x) < 5.0 && Math.abs(v.startPos.y - centerPos.y) < 5.0;
            });

            const hasUpwardForceFromCenter = userVectors.some(v => {
                const uFx = v.vx * FORCE_SCALE_FACTOR;
                const uFy = v.vy * FORCE_SCALE_FACTOR;
                return Math.abs(uFx - 0) < 0.2 && Math.abs(uFy - (-15)) < 0.2 &&
                       Math.abs(v.startPos.x - centerPos.x) < 5.0 && Math.abs(v.startPos.y - centerPos.y) < 5.0;
            });

            if (hasCorrectGravity && hasUpwardForceFromCenter) {
                generalErrorCount = 0; 
                // ★ alert を showCustomAlert に変更
                showCustomAlert("ヒント：はたらいている力の大きさと向きはいいですね！上向きの力は物体の中心からはたらくのであってますか？上向きの力は何という力かも思い出してもう一度作図しましょう！");
                return false;
            }

            // 【パターン2の判定】
            const hasCorrectNormalForce = userVectors.some(v => {
                const uFx = v.vx * FORCE_SCALE_FACTOR;
                const uFy = v.vy * FORCE_SCALE_FACTOR;
                return Math.abs(uFx - 0) < 0.2 && Math.abs(uFy - (-15)) < 0.2 &&
                       Math.abs(v.startPos.x - bottomPos.x) < 20.0 && Math.abs(v.startPos.y - bottomPos.y) < 10.0;
            });

            const hasDownwardForceFromBottom = userVectors.some(v => {
                const uFx = v.vx * FORCE_SCALE_FACTOR;
                const uFy = v.vy * FORCE_SCALE_FACTOR;
                return Math.abs(uFx - 0) < 0.2 && Math.abs(uFy - 15) < 0.2 &&
                       Math.abs(v.startPos.x - bottomPos.x) < 20.0 && Math.abs(v.startPos.y - bottomPos.y) < 10.0;
            });

            if (hasCorrectNormalForce && hasDownwardForceFromBottom) {
                generalErrorCount = 0; 
                // ★ alert を showCustomAlert に変更
                showCustomAlert("ヒント：はたらいている力の大きさと向きはいいですね！下向きの力は床との接触面からはたらくのであってますか？下向きの力は何という力かも思い出してもう一度作図しましょう！");
                return false;
            }

            // --- ★上記以外の一般的な誤りが続いた場合の処理 ---
            generalErrorCount++;
            
            if (generalErrorCount >= 5) {
                generalErrorCount = 0; 
                showHintQuizModal(1);  
            } else {
                // ★ alert を showCustomAlert に変更
                showCustomAlert("不正解です。作図の大きさや向き、位置を見直してみましょう。"); 
            }
            return false; 
        }
    }

    function sendActionLog(actionType) {
        try {
            const consent = sessionStorage.getItem('physics_app_consent');
            if (consent !== 'true') return;

            if (!ACTION_LOG_URL) return;
            const userName = sessionStorage.getItem('physics_app_username') || "ゲスト";
            const allVectors = [...box1Vectors];
            const vectorData = allVectors.map(v => ({
                start: { x: v.startPos.x, y: v.startPos.y },
                end:   { x: v.startPos.x + v.vx, y: v.startPos.y + v.vy }
            }));
            const data = { name: userName, appId: APP_ID, actionType: actionType, vectors: vectorData };
            if (navigator.sendBeacon) { navigator.sendBeacon(ACTION_LOG_URL, new Blob([JSON.stringify(data)], { type: 'text/plain' })); } 
            else { fetch(ACTION_LOG_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(data) }).catch(e => console.error(e)); }
        } catch(e) { console.error(e); }
    }

    // --- アニメーションループ ---
    function gameLoop() {
        updateSimulation();
        drawSimulation();
        requestAnimationFrame(gameLoop);
    }

    createObjectStates(); 
    gameLoop();           

});
