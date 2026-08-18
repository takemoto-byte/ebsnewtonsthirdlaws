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

    // --- ボタン設定 (3つ並べるための配置計算) ---
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
    const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbymGS9vU-xHbfOrd8tHfyISyLSl3g1EI47OvQjqRDg94iX9ITwhAKvSOoujCQahLYuVEg/exec"; 
    const ACTION_LOG_URL = "https://script.google.com/macros/s/AKfycbyEY0cnE-qSG1KH3UUXpaEmbu4OLATEz9Rd3rIcR2omKeKROYsHdYAVFMC_CBVVnDh1qg/exec"; 
    const APP_ID = 1;

    // --- 正解データ設定 ---
    const CORRECT_ANSWERS = [
        {
            objectId: 'box1', // 緑の物体
            vectors: [
                { id: "box1_gravity", name: "重力", fx: 0, fy: 10, startPosType: 'center' },
                { id: "box1_normal",  name: "床からの垂直抗力", fx: 0, fy: -15, startPosType: 'bottom+12,-5' },
                { id: "box1_push",    name: "赤の物体からの押す力", fx: 0, fy: 5, startPosType: 'top-12,5' }
            ]
        },
        {
            objectId: 'box2', // 赤の物体
            vectors: [
                { id: "box2_gravity", name: "重力", fx: 0, fy: 5, startPosType: 'center' },
                { id: "box2_normal",  name: "緑の物体からの垂直抗力", fx: 0, fy: -5, startPosType: 'bottom+12,-5' }
            ]
        }
    ];

    // --- ミス判定ロジック設定 ---
    const MAX_ATTEMPTS = 3; 
    const PRIORITY_LIST = ["box1_gravity", "box2_gravity", "box1_normal", "box2_normal", "box1_push"];
    const DESTINATION_MAP = {
        "box1_gravity": "index2.html", "box2_gravity": "index2.html", "box1_normal":  "index2.html", 
        "box2_normal":  "index3.html", "box1_push":    "index3.html"
    };

    // --- 状態管理変数 ---
    let isRunning = false;
    let isDrawingVector = false;
    let vectorStartPos = null;
    let currentMousePos = { x: 0, y: 0 };
    let targetObject = null; 
    let validationTimer = null;

    let attemptCount = 0; 
    let missingVectorCounts = {}; 
    let totalSessionErrors = { "box1_gravity": 0, "box1_normal": 0, "box1_push": 0, "box2_gravity": 0, "box2_normal": 0 };

    let box1, box2;
    let box1Vectors = [];
    let box2Vectors = [];
    let forceTextStamps = [];
    
    // ★操作履歴スタック (戻るボタン用)
    // 中身: 'box1' または 'box2' の文字列を入れて、どの配列に追加したかを記録する
    let actionHistory = [];

    let calculatedMass1 = 0.0, calculatedMass2 = 0.0;
    let showMassText = false;

    // --- クラス定義 ---
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

    // --- メインロジック ---
    
    // オブジェクト状態の初期化
    function createObjectStates(needLog = true) {
        // リセットログ送信
        try {
            if (needLog && ((box1Vectors && box1Vectors.length > 0) || (box2Vectors && box2Vectors.length > 0))) {
                sendActionLog(0); 
            }
        } catch (e) {
            console.error("Log error:", e);
        }

        if (validationTimer) clearTimeout(validationTimer);
        const box1Width = 160, box1Height = 80, box1Mass = 1.0;
        const box1InitialX = SCREEN_WIDTH / 2.0 - box1Width / 2.0;
        const box1InitialY = floorRect.y - box1Height;
        box1 = new PhysicsObject(box1InitialX, box1InitialY, box1Width, box1Height, box1Mass, 'rgb(100, 255, 100)');

        const box2Width = 80, box2Height = 80, box2Mass = 0.5;
        const box2InitialX = SCREEN_WIDTH / 2.0 - box2Width / 2.0;
        const box2InitialY = box1InitialY - box2Height;
        box2 = new PhysicsObject(box2InitialX, box2InitialY, box2Width, box2Height, box2Mass, 'rgb(255, 100, 100)');
        
        isRunning = false;
        box1Vectors = []; box2Vectors = []; forceTextStamps = [];
        actionHistory = []; // 履歴もリセット
        showMassText = false;
        calculatedMass1 = 0.0; calculatedMass2 = 0.0;
    }

    // ★ 1つ戻る処理
    function undoLastAction() {
        if (actionHistory.length === 0) return; // 履歴がなければ何もしない

        // ログ送信 (タイプ2: 戻る)
        try {
            sendActionLog(2);
        } catch (e) {
            console.error("Log error:", e);
        }

        const lastTarget = actionHistory.pop(); // 最後の操作を取り出す

        // 対応する配列から最後の要素を削除
        if (lastTarget === 'box1') {
            box1Vectors.pop();
        } else if (lastTarget === 'box2') {
            box2Vectors.pop();
        }

        // テキストスタンプも1つ消す (矢印と対になっているため)
        forceTextStamps.pop();
    }

    function startSimulation() {
        if (isRunning) return;

        // 再生ログ送信
        try {
            sendActionLog(1); 
        } catch (e) {
            console.error("Log error:", e);
        }

        // --- 物理計算 ---
        const netForceVX1 = box1Vectors.reduce((sum, v) => sum + v.vx, 0);
        let netForceVY1 = box1Vectors.reduce((sum, v) => sum + v.vy, 0);
        let upwardVectors1 = box1Vectors.filter(v => v.vy < 0).reduce((sum, v) => sum + v.vy, 0);
        let netForceN_VX1 = netForceVX1 * FORCE_SCALE_FACTOR;
        let netForceN_VY1 = netForceVY1 * FORCE_SCALE_FACTOR;
        let netForceN_VY1_pygame = -netForceN_VY1;
        
        box1.ax = (netForceN_VX1 * FORCE_SCALE_FACTOR) / box1.mass;
        box1.ay = (netForceN_VY1 * FORCE_SCALE_FACTOR) / box1.mass;
        if (Math.abs(netForceN_VX1) < 0.09 && Math.abs(netForceN_VY1) < 0.09) { box1.ax = 0; box1.ay = 0; }
        
        if (netForceN_VY1_pygame < 0) calculatedMass1 = -1 * upwardVectors1 * FORCE_SCALE_FACTOR / GRAVITY_ACCELERATION;
        else if (netForceN_VY1_pygame >= 0 && netForceN_VY1_pygame < 0.09) calculatedMass1 = -1 * upwardVectors1 * FORCE_SCALE_FACTOR / GRAVITY_ACCELERATION;
        else calculatedMass1 = 0;
        
        const netForceVX2 = box2Vectors.reduce((sum, v) => sum + v.vx, 0);
        let netForceVY2 = box2Vectors.reduce((sum, v) => sum + v.vy, 0);
        let upwardVectors2 = box2Vectors.filter(v => v.vy < 0).reduce((sum, v) => sum + v.vy, 0);
        let netForceN_VX2 = netForceVX2 * FORCE_SCALE_FACTOR;
        let netForceN_VY2 = netForceVY2 * FORCE_SCALE_FACTOR;
        let netForceN_VY2_pygame = -netForceN_VY2;

        box2.ax = (netForceN_VX2 * FORCE_SCALE_FACTOR) / box2.mass;
        box2.ay = (netForceN_VY2 * FORCE_SCALE_FACTOR) / box2.mass;
        if (Math.abs(netForceN_VX2) < 0.09 && Math.abs(netForceN_VY2) < 0.09) { box2.ax = 0; box2.ay = 0; }
        
        if (netForceN_VY2_pygame < 0) calculatedMass2 = -1 * upwardVectors2 * FORCE_SCALE_FACTOR / GRAVITY_ACCELERATION;
        else if (netForceN_VY2_pygame >= 0 && netForceN_VY2_pygame < 0.09) calculatedMass2 = -1 * upwardVectors2 * FORCE_SCALE_FACTOR / GRAVITY_ACCELERATION;
        else calculatedMass2 = 0;

        showMassText = true;
        isRunning = true;
    
        if (validationTimer) clearTimeout(validationTimer);
        
        validationTimer = setTimeout(() => {
            const checkResult = checkAnswerDetails(); 
            if (checkResult.isCorrect) {
                try { sendToGoogleSheet(true); } catch(e) { console.error(e); }
                setTimeout(() => { window.location.href = "end.html"; }, 500);
            } else {
                handleIncorrect(checkResult.missingIds);
                isRunning = false;
            }
        }, 1000); 
    }

    function checkAnswerDetails() {
        let missingIds = []; let allCorrect = true;
        CORRECT_ANSWERS.forEach(answerSet => {
            let userVectors = []; let targetBox = null;
            if (answerSet.objectId === 'box1') { userVectors = box1Vectors; targetBox = box1; } 
            else if (answerSet.objectId === 'box2') { userVectors = box2Vectors; targetBox = box2; }

            let remainingUserVectors = [...userVectors];
            answerSet.vectors.forEach(correctVec => {
                const correctStartPos = getTargetPos(targetBox, correctVec.startPosType);
                const foundIndex = remainingUserVectors.findIndex(uVec => {
                    const uFx_N = uVec.vx * FORCE_SCALE_FACTOR;
                    const uFy_N = uVec.vy * FORCE_SCALE_FACTOR;
                    const forceTolerance = 0.2; const posTolerance = 5.0; 
                    return Math.abs(uFx_N - correctVec.fx) < forceTolerance &&
                           Math.abs(uFy_N - correctVec.fy) < forceTolerance &&
                           Math.abs(uVec.startPos.x - correctStartPos.x) < posTolerance &&
                           Math.abs(uVec.startPos.y - correctStartPos.y) < posTolerance;
                });
                if (foundIndex !== -1) { remainingUserVectors.splice(foundIndex, 1); } 
                else { missingIds.push(correctVec.id); allCorrect = false; }
            });
            if (remainingUserVectors.length > 0) allCorrect = false;
        });
        return { isCorrect: allCorrect, missingIds: missingIds };
    }

    function handleIncorrect(missingIds) {
        attemptCount++; 
        missingIds.forEach(id => {
            if (!missingVectorCounts[id]) missingVectorCounts[id] = 0;
            missingVectorCounts[id]++;
            if (totalSessionErrors.hasOwnProperty(id)) totalSessionErrors[id]++; else totalSessionErrors[id] = 1;
        });

        if (attemptCount >= MAX_ATTEMPTS) {
            analyzeAndRedirect();
        } else {
            const remaining = MAX_ATTEMPTS - attemptCount;
            alert(`不正解です。\nあと${remaining}回間違えると、補助問題へ移動します。`);
            createObjectStates(false); // 不正解リセット（ログなし）
        }
    }

    function analyzeAndRedirect() {
        const errorIds = Object.keys(missingVectorCounts);
        if (errorIds.length === 0) {
            alert("余計な力が描かれています。基礎から復習しましょう。");
            window.location.href = "index2.html";
            return;
        }
        errorIds.sort((a, b) => {
            const countA = missingVectorCounts[a], countB = missingVectorCounts[b];
            if (countB !== countA) return countB - countA;
            const pA = (PRIORITY_LIST.indexOf(a) === -1) ? 999 : PRIORITY_LIST.indexOf(a);
            const pB = (PRIORITY_LIST.indexOf(b) === -1) ? 999 : PRIORITY_LIST.indexOf(b);
            return pA - pB;
        });

        const primaryCauseId = errorIds[0];
        const destination = DESTINATION_MAP[primaryCauseId] || "index2.html"; 
        
        try { sendToGoogleSheet(false); } catch(e) { console.error(e); }

        alert(`3回不正解となりました。\n適した補助問題へ移動します。`);
        window.location.href = destination;
    }

    function updateSimulation() {
        if (!isRunning) return;
        box1.update(); box2.update();
    }
    
    function drawSimulation() {
        ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        const userName = sessionStorage.getItem('physics_app_username') || "ゲスト";
        ctx.fillStyle = '#555'; ctx.font = "14px 'Meiryo', sans-serif"; ctx.textAlign = "right";
        ctx.fillText(`学習者: ${userName}`, SCREEN_WIDTH - 20, 30); ctx.textAlign = "left"; 
        ctx.fillStyle = FLOOR_COLOR; ctx.fillRect(floorRect.x, floorRect.y, floorRect.width, floorRect.height);
        ctx.fillStyle = 'black'; ctx.font = INSTRUCTION_FONT;
        ctx.fillText("質量1.0kgの緑色の物体と質量0.50㎏の赤色の物体にはたらく力を作図して", 10, 25);
        ctx.fillText("再生ボタンを押してみましょう。ただし、1.0㎏の物体にはたらく重力の大きさ", 10, 45);
        ctx.fillText("を10Nとする。また、灰色の床と緑色の物体の上面ははかりになっている。", 10, 65);
        
        box1.draw(ctx); box2.draw(ctx);
        
        const startPosCounts = {}; 
        const drawWithOffset = (vectorList) => {
            vectorList.forEach(v => {
                const key = `${v.startPos.x},${v.startPos.y}`;
                const count = startPosCounts[key] || 0;
                let offset = 0;
                if (count > 0) {
                    const gap = 6; const sign = (count % 2 === 1) ? 1 : -1;
                    const multiplier = Math.ceil(count / 2.0);
                    offset = multiplier * gap * sign;
                }
                v.draw(ctx, offset, 0); startPosCounts[key] = count + 1;
            });
        };
        drawWithOffset(box1Vectors); drawWithOffset(box2Vectors);
        
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
            ctx.fillText(`灰色の床がはかる重さ `, 10, 305); ctx.fillText(` ${calculatedMass1.toFixed(2)} kg`, 10, 330);
            ctx.fillText(`緑色の物体の上面がはかる重さ`, 10, 355); ctx.fillText(` ${calculatedMass2.toFixed(2)} kg`, 10, 380);
        }
        
        // 3つのボタンを描画
        drawButton(ctx, startButtonRect, START_BUTTON_COLOR_IDLE, "再生");
        drawButton(ctx, undoButtonRect,  UNDO_BUTTON_COLOR_IDLE,  "1つ戻る");
        drawButton(ctx, resetButtonRect, RESET_BUTTON_COLOR_IDLE, "リセット");
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
        else if (isPointInRect(p, undoButtonRect)) { undoLastAction(); } // 戻るボタン
        else if (isPointInRect(p, resetButtonRect)) { createObjectStates(); } 
        else if (box1.collidesWith(p)) { isDrawingVector = true; targetObject = box1; vectorStartPos = getNearestSnapPoint(p, box1); } 
        else if (box2.collidesWith(p)) { isDrawingVector = true; targetObject = box2; vectorStartPos = getNearestSnapPoint(p, box2); }
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
        
        if (targetObject === box1) { 
            box1Vectors.push(new ForceVector(vectorStartPos, snappedComponents.vx, snappedComponents.vy, color)); 
            actionHistory.push('box1'); // 履歴に追加
        } else if (targetObject === box2) { 
            box2Vectors.push(new ForceVector(vectorStartPos, snappedComponents.vx, snappedComponents.vy, color)); 
            actionHistory.push('box2'); // 履歴に追加
        }
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

    // --- ログ送信関数 (同意チェック付き + 安全化) ---
    function sendToGoogleSheet(isSuccess) {
        try {
            const consent = sessionStorage.getItem('physics_app_consent');
            if (consent !== 'true') return; 

            if (!GOOGLE_SCRIPT_URL) return;
            const userName = sessionStorage.getItem('physics_app_username') || "ゲスト";
            const data = { name: userName, errors: totalSessionErrors, isCompleted: isSuccess };
            
            if (navigator.sendBeacon) {
                navigator.sendBeacon(GOOGLE_SCRIPT_URL, new Blob([JSON.stringify(data)], { type: 'text/plain' }));
            } else {
                fetch(GOOGLE_SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(data) }).catch(e => console.error(e));
            }
        } catch (e) { console.error("Send result error:", e); }
    }

    function sendActionLog(actionType) {
        try {
            const consent = sessionStorage.getItem('physics_app_consent');
            if (consent !== 'true') return;

            if (!ACTION_LOG_URL) return;
            const userName = sessionStorage.getItem('physics_app_username') || "ゲスト";
            
            const allVectors = [...box1Vectors, ...box2Vectors];
            const vectorData = allVectors.map(v => ({
                start: { x: v.startPos.x, y: v.startPos.y },
                end:   { x: v.startPos.x + v.vx, y: v.startPos.y + v.vy }
            }));
            const data = { name: userName, appId: APP_ID, actionType: actionType, vectors: vectorData };
            if (navigator.sendBeacon) { navigator.sendBeacon(ACTION_LOG_URL, new Blob([JSON.stringify(data)], { type: 'text/plain' })); } 
            else { fetch(ACTION_LOG_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(data) }).catch(e => console.error(e)); }
        } catch (e) { console.error("Send log error:", e); }
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