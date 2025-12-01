// DOMの読み込みが完了したらスクリプトを実行
document.addEventListener('DOMContentLoaded', () => {

    // --- キャンバスとコンテキストの取得 ---
    const canvas = document.getElementById('simulationCanvas');
    if (!canvas.getContext) return;
    const ctx = canvas.getContext('2d');

    // --- シミュレーション設定 ---
    const SCREEN_WIDTH = canvas.width;
    const SCREEN_HEIGHT = canvas.height;
    
    // --- 物理定数 ---
    const GRAVITY_ACCELERATION = 10;

    // --- 床 ---
    const FLOOR_HEIGHT = 200;
    const FLOOR_COLOR = 'rgb(230, 230, 230)'; 
    const floorRect = { x: 0, y: SCREEN_HEIGHT - FLOOR_HEIGHT, width: SCREEN_WIDTH, height: FLOOR_HEIGHT };

    // --- ベクトル ---
    const VECTOR_WIDTH = 2;
    const VECTOR_COLORS = ['#000000']; 
    const FORCE_SCALE_FACTOR = 0.1;

    // --- ボタン ---
    const buttonWidth = 100, buttonHeight = 40, buttonPadding = 140;
    const startButtonX = (SCREEN_WIDTH - (buttonWidth * 2 + buttonPadding)) / 2;
    const startButtonY = SCREEN_HEIGHT - buttonHeight - 10;
    
    const startButtonRect = { x: startButtonX, y: startButtonY, width: buttonWidth, height: buttonHeight };
    const resetButtonRect = { x: startButtonX + buttonWidth + buttonPadding, y: startButtonY, width: buttonWidth, height: buttonHeight };
    
    const START_BUTTON_COLOR_IDLE = '#90EE90'; 
    const RESET_BUTTON_COLOR_IDLE = '#ADD8E6'; 
    const BUTTON_FONT = "bold 20px 'Meiryo', sans-serif";
    const INSTRUCTION_FONT = "16px 'Meiryo', sans-serif";

    // --- 正解データ設定 ---
    // ベクトルに一意なID (id) を付与して管理しやすくしています
    const CORRECT_ANSWERS = [
        {
            objectId: 'box1', // 緑の物体（下, 1.0kg）
            vectors: [
                { id: "box1_gravity", name: "重力", fx: 0, fy: 10, startPosType: 'center' },
                { id: "box1_normal",  name: "床からの垂直抗力", fx: 0, fy: -15, startPosType: 'bottom+12,0' },
                { id: "box1_push",    name: "赤の物体からの押す力", fx: 0, fy: 5, startPosType: 'top-12,0' }
            ]
        },
        {
            objectId: 'box2', // 赤の物体（上, 0.5kg）
            vectors: [
                { id: "box2_gravity", name: "重力", fx: 0, fy: 5, startPosType: 'center' },
                { id: "box2_normal",  name: "緑の物体からの垂直抗力", fx: 0, fy: -5, startPosType: 'bottom+12,0' }
            ]
        }
    ];

    // ★追加機能: ミス判定ロジック設定 ---
    
    const MAX_ATTEMPTS = 5; // 許容される試行回数

    // 優先順位リスト (配列の先頭ほど優先度が高い = 基本的な間違い)
    // もしミスカウントが同数の場合、このリストで上にあるものが「主たる原因」として選ばれます。
    const PRIORITY_LIST = [
        "box1_gravity", // 最重要：緑の重力
        "box2_gravity", // 最重要：赤の重力
        "box1_normal",  // 基礎：床からの垂直抗力
        "box2_normal",  // 応用：接触面での垂直抗力（作用反作用）
        "box1_push"     // 応用：接触面での押す力（作用反作用）
    ];

    // エラーIDごとの遷移先マップ
    const DESTINATION_MAP = {
        // 重力や床からの垂直抗力が抜けている -> 基礎の「1物体」へ
        "box1_gravity": "index2.html",
        "box2_gravity": "index2.html",
        "box1_normal":  "index2.html",
        "box2_normal":  "index3.html",

        // 接触力（作用・反作用）が抜けている -> 外力の「指で押す」へ
        "box1_push":    "index3.html"
    };

    // --- 状態管理変数 ---
    let isRunning = false;
    let isDrawingVector = false;
    let vectorStartPos = null;
    let currentMousePos = { x: 0, y: 0 };
    let targetObject = null; 
    let validationTimer = null;

    // ★追加: 診断用カウンタ
    let attemptCount = 0; // 現在の試行回数
    let missingVectorCounts = {}; // 各ベクトルのミス回数を記録 { "box1_gravity": 3, ... }

    let box1, box2;
    let box1Vectors = [];
    let box2Vectors = [];
    let forceTextStamps = [];

    let calculatedMass1 = 0.0, calculatedMass2 = 0.0;
    let showMassText = false;

    // --- クラス定義 ---

    /** 物理オブジェクトクラス */
    class PhysicsObject {
        constructor(x, y, w, h, m, c) {
            this.x = x; this.y = y; this.width = w; this.height = h;
            this.mass = m; this.color = c;
            this.vx = 0; this.vy = 0; this.ax = 0; this.ay = 0;
            this.initialRect = { x: x, y: y, width: w, height: h };
        }

        update() {
            this.vx += this.ax;
            this.vy += this.ay;
            this.x += this.vx;
            this.y += this.vy;
        }

        draw(ctx) {
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 1;
            ctx.strokeRect(this.x, this.y, this.width, this.height);
        }

        collidesWith(p) {
            return p.x >= this.initialRect.x && p.x <= this.initialRect.x + this.initialRect.width &&
                   p.y >= this.initialRect.y && p.y <= this.initialRect.y + this.initialRect.height;
        }
    }

    /** 力ベクトルクラス */
    class ForceVector {
        constructor(startPos, vx, vy, color) {
            this.startPos = startPos;
            this.vx = vx;
            this.vy = vy;
            this.color = color;
        }
        draw(ctx, offsetX = 0, offsetY = 0) {
            ctx.strokeStyle = this.color;
            ctx.lineWidth = VECTOR_WIDTH;
            drawVector(
                ctx, 
                this.startPos.x + offsetX, 
                this.startPos.y + offsetY, 
                this.startPos.x + this.vx + offsetX, 
                this.startPos.y + this.vy + offsetY
            );
        }
    }

    /** 力テキストクラス */
    class ForceText {
        constructor(text, pos) {
            this.text = text;
            this.pos = pos;
        }
        draw(ctx) {
            ctx.fillStyle = 'black';
            ctx.font = BUTTON_FONT;
            ctx.fillText(this.text, this.pos.x, this.pos.y);
        }
    }

    // --- メインロジック関数 ---

    function createObjectStates() {
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
        box1Vectors = [];
        box2Vectors = [];
        forceTextStamps = [];
        showMassText = false;
        calculatedMass1 = 0.0;
        calculatedMass2 = 0.0;
    }

    function startSimulation() {
        if (isRunning) return;

        // --- 物理計算 (既存のまま) ---
        // --- Box 1 (緑) ---
        const netForceVX1 = box1Vectors.reduce((sum, v) => sum + v.vx, 0);
        let netForceVY1 = box1Vectors.reduce((sum, v) => sum + v.vy, 0);
        let downwardVectors1 = box1Vectors.filter(v => v.vy > 0).reduce((sum, v) => sum + v.vy, 0);
        let upwardVectors1 = box1Vectors.filter(v => v.vy < 0).reduce((sum, v) => sum + v.vy, 0);

        let netForceN_VX1 = netForceVX1 * FORCE_SCALE_FACTOR;
        let netForceN_VY1 = netForceVY1 * FORCE_SCALE_FACTOR;
        let netDownwardVectors1 = downwardVectors1 * FORCE_SCALE_FACTOR;
        let netupwardVectors1 = upwardVectors1 * FORCE_SCALE_FACTOR;

        let netForceN_VY1_pygame = -netForceN_VY1;

        box1.ax = (netForceN_VX1 * FORCE_SCALE_FACTOR) / box1.mass;
        box1.ay = (netForceN_VY1 * FORCE_SCALE_FACTOR) / box1.mass;

        if (Math.abs(netForceN_VX1) < 0.09 && Math.abs(netForceN_VY1) < 0.09) {
            box1.ax = 0; box1.ay = 0;
        }

        if (netForceN_VY1_pygame < 0) calculatedMass1 = -1 * netupwardVectors1 / GRAVITY_ACCELERATION;
        else if (netForceN_VY1_pygame >= 0 && netForceN_VY1_pygame < 0.09) calculatedMass1 = -1 * netupwardVectors1 / GRAVITY_ACCELERATION;
        else calculatedMass1 = 0;
        
        // --- Box 2 (赤) ---
        const netForceVX2 = box2Vectors.reduce((sum, v) => sum + v.vx, 0);
        let netForceVY2 = box2Vectors.reduce((sum, v) => sum + v.vy, 0);
        let downwardVectors2 = box2Vectors.filter(v => v.vy > 0).reduce((sum, v) => sum + v.vy, 0);
        let upwardVectors2 = box2Vectors.filter(v => v.vy < 0).reduce((sum, v) => sum + v.vy, 0);

        let netForceN_VX2 = netForceVX2 * FORCE_SCALE_FACTOR;
        let netForceN_VY2 = netForceVY2 * FORCE_SCALE_FACTOR;
        let netDownwardVectors2 = downwardVectors2 * FORCE_SCALE_FACTOR;
        let netupwardVectors2 = upwardVectors2 * FORCE_SCALE_FACTOR;

        let netForceN_VY2_pygame = -netForceN_VY2;

        box2.ax = (netForceN_VX2 * FORCE_SCALE_FACTOR) / box2.mass;
        box2.ay = (netForceN_VY2 * FORCE_SCALE_FACTOR) / box2.mass;
        
        if (Math.abs(netForceN_VX2) < 0.09 && Math.abs(netForceN_VY2) < 0.09) {
             box2.ax = 0; box2.ay = 0;
        }

        if (netForceN_VY2_pygame < 0) calculatedMass2 = -1 * netupwardVectors2 / GRAVITY_ACCELERATION;
        else if (netForceN_VY2_pygame >= 0 && netForceN_VY2_pygame < 0.09) calculatedMass2 = -1 * netupwardVectors2 / GRAVITY_ACCELERATION;
        else calculatedMass2 = 0;

        showMassText = true;
        isRunning = true;
    
        if (validationTimer) clearTimeout(validationTimer);
        
        validationTimer = setTimeout(() => {
            // ★修正: 詳細なエラー情報を取得する関数を呼ぶ
            const checkResult = checkAnswerDetails(); 
            
            if (checkResult.isCorrect) {
                alert("正解です！おめでとうございます！");
                // 成功したらカウンタリセット
                attemptCount = 0;
                missingVectorCounts = {};
            } else {
                // 間違い処理へ
                handleIncorrect(checkResult.missingIds);
                isRunning = false;
            }
        }, 1000); 
    }

    /** * 詳細な正誤判定を行い、抜けているベクトルのIDリストを返す 
     */
    function checkAnswerDetails() {
        let missingIds = [];
        let allCorrect = true;

        CORRECT_ANSWERS.forEach(answerSet => {
            let userVectors = [];
            let targetBox = null;

            if (answerSet.objectId === 'box1') {
                userVectors = box1Vectors;
                targetBox = box1;
            } else if (answerSet.objectId === 'box2') {
                userVectors = box2Vectors;
                targetBox = box2;
            }

            let remainingUserVectors = [...userVectors];

            answerSet.vectors.forEach(correctVec => {
                const correctStartPos = getTargetPos(targetBox, correctVec.startPosType);

                const foundIndex = remainingUserVectors.findIndex(uVec => {
                    const uFx_N = uVec.vx * FORCE_SCALE_FACTOR;
                    const uFy_N = uVec.vy * FORCE_SCALE_FACTOR;
                    const forceTolerance = 0.2; 
                    const posTolerance = 5.0; 

                    const matchForceX = Math.abs(uFx_N - correctVec.fx) < forceTolerance;
                    const matchForceY = Math.abs(uFy_N - correctVec.fy) < forceTolerance;
                    const matchPosX = Math.abs(uVec.startPos.x - correctStartPos.x) < posTolerance;
                    const matchPosY = Math.abs(uVec.startPos.y - correctStartPos.y) < posTolerance;

                    return matchForceX && matchForceY && matchPosX && matchPosY;
                });

                if (foundIndex !== -1) {
                    remainingUserVectors.splice(foundIndex, 1);
                } else {
                    // 見つからなかった場合、そのIDをリストに追加
                    missingIds.push(correctVec.id);
                    allCorrect = false;
                }
            });
            
            // 余計な矢印がある場合も不正解とする（今回はカウント対象外だがfalseにはする）
            if (remainingUserVectors.length > 0) {
                allCorrect = false;
            }
        });

        return { isCorrect: allCorrect, missingIds: missingIds };
    }

    /** * 不正解時の処理（カウント・分析・遷移） 
     */
    function handleIncorrect(missingIds) {
        attemptCount++; // 試行回数をプラス

        // 今回抜けていたベクトルをカウントアップ
        missingIds.forEach(id => {
            if (!missingVectorCounts[id]) {
                missingVectorCounts[id] = 0;
            }
            missingVectorCounts[id]++;
        });

        console.log(`試行回数: ${attemptCount}/${MAX_ATTEMPTS}`);
        console.log("現在のエラー集計:", missingVectorCounts);

        // 10回間違えたら分析開始
        if (attemptCount >= MAX_ATTEMPTS) {
            analyzeAndRedirect();
        } else {
            const remaining = MAX_ATTEMPTS - attemptCount;
            alert(`不正解です。\nあと${remaining}回間違えると、補助問題へ移動します。`);
        }
    }

    /** * 集計結果を分析し、適切なページへ飛ばす 
     */
    function analyzeAndRedirect() {
        // ミス回数が多い順、かつ優先順位が高い順にソートするためのキー配列を作成
        const errorIds = Object.keys(missingVectorCounts);

        if (errorIds.length === 0) {
            // ミスがあるはずなのにIDがない場合（余計な矢印を描いたケースなど）
            alert("余計な力が描かれています。基礎から復習しましょう。");
            window.location.href = "index2.html";
            return;
        }

        // ソート関数
        errorIds.sort((a, b) => {
            const countA = missingVectorCounts[a];
            const countB = missingVectorCounts[b];

            // 1. カウントが多い方を優先（降順）
            if (countB !== countA) {
                return countB - countA;
            }

            // 2. カウントが同じ場合、PRIORITY_LISTのインデックスが小さい（優先度が高い）方を優先
            const priorityA = PRIORITY_LIST.indexOf(a);
            const priorityB = PRIORITY_LIST.indexOf(b);
            
            // 見つからない場合は後ろに回す
            const pA = (priorityA === -1) ? 999 : priorityA;
            const pB = (priorityB === -1) ? 999 : priorityB;

            return pA - pB;
        });

        // 最も原因となっているベクトルのID
        const primaryCauseId = errorIds[0];
        const destination = DESTINATION_MAP[primaryCauseId] || "index2.html"; // デフォルトは基礎

        alert(`5回不正解となりました。\n適した補助問題へ移動します。`);
        
        // 画面遷移
        window.location.href = destination;
    }

    function updateSimulation() {
        if (!isRunning) return;
        box1.update();
        box2.update();
    }

    function drawSimulation() {
        ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        
        ctx.fillStyle = FLOOR_COLOR;
        ctx.fillRect(floorRect.x, floorRect.y, floorRect.width, floorRect.height);

        ctx.fillStyle = 'black';
        ctx.font = INSTRUCTION_FONT;
        ctx.fillText("質量1.0kgの緑色の物体と質量0.50㎏の赤色の物体にはたらく力を作図して", 280, 25);
        ctx.fillText("再生ボタンを押してみましょう。ただし、1.0㎏の物体にはたらく重力の大きさ", 290, 45);
        ctx.fillText("を10Nとする。また、灰色の床と緑色の物体の上面ははかりになっている。", 280, 65);

        box1.draw(ctx);
        box2.draw(ctx);

        // --- (5) ベクトルの描画（重なり対応版） ---
        const startPosCounts = {}; 

        const drawWithOffset = (vectorList) => {
            vectorList.forEach(v => {
                const key = `${v.startPos.x},${v.startPos.y}`;
                const count = startPosCounts[key] || 0;
                
                let offset = 0;
                if (count > 0) {
                    const gap = 6; 
                    const sign = (count % 2 === 1) ? 1 : -1;
                    const multiplier = Math.ceil(count / 2.0);
                    offset = multiplier * gap * sign;
                }

                // X方向だけずらす
                v.draw(ctx, offset, 0);

                startPosCounts[key] = count + 1;
            });
        };

        drawWithOffset(box1Vectors);
        drawWithOffset(box2Vectors);
        
        // (6) 描画中のベクトル
        if (isDrawingVector && vectorStartPos) {
            const snappedComponents = snapVectorComponents(vectorStartPos, currentMousePos);
            const snappedVX = snappedComponents.vx;
            const snappedVY = snappedComponents.vy;
            const snappedEndPosX = vectorStartPos.x + snappedVX;
            const snappedEndPosY = vectorStartPos.y + snappedVY;

            const color = VECTOR_COLORS[0];
            ctx.strokeStyle = color;
            ctx.lineWidth = VECTOR_WIDTH;
            
            drawVector(ctx, vectorStartPos.x, vectorStartPos.y, snappedEndPosX, snappedEndPosY);

            const snappedMagnitude = Math.sqrt(snappedVX * snappedVX + snappedVY * snappedVY);
            const mag = snappedMagnitude * FORCE_SCALE_FACTOR;
            const magText = `${mag.toFixed(1)} N`;
            
            ctx.fillStyle = 'black';
            ctx.font = BUTTON_FONT;
            // ★スナップ計算された「実際の矢印の先端」座標を使う
            ctx.fillText(magText, snappedEndPosX + 50, snappedEndPosY -20);
        }

        // (7) 保存された力のテキスト
        forceTextStamps.forEach(t => t.draw(ctx));

        // (8) 質量計算結果
        if (showMassText) {
            ctx.font = BUTTON_FONT;
            ctx.fillStyle = 'black'; 
            ctx.fillText(`灰色の床がはかる重さ `, 110, 300);
            ctx.fillText(` ${calculatedMass1.toFixed(2)} kg`, 110, 325);
            ctx.fillText(`緑色の物体の上面がはかる重さ`, 145, 350);
            ctx.fillText(` ${calculatedMass2.toFixed(2)} kg`, 110, 375);
        }

        // (9) ボタンの描画
        drawButton(ctx, startButtonRect, START_BUTTON_COLOR_IDLE, "再生");
        drawButton(ctx, resetButtonRect, RESET_BUTTON_COLOR_IDLE, "リセット");
    }

    // --- ヘルパー関数群 ---
    
    function getSnapPoints(box) {
        const rect = box.initialRect; 
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;

        return [
            { x: centerX, y: centerY },    // 1. 中心
            { x: centerX-12, y: rect.y },     // 2. 上辺中点
            { x: centerX+12, y: rect.y + rect.height }, // 3. 下辺中点
            { x: rect.x, y: centerY },     // 4. 左辺中点
            { x: rect.x + rect.width, y: centerY } // 5. 右辺中点
        ];
    }

    function getNearestSnapPoint(p, box) {
        const snapPoints = getSnapPoints(box);
        let minDistance = Infinity;
        let nearestPoint = null;

        for (const sp of snapPoints) {
            const dist = getDistance(p, sp);
            if (dist < minDistance) {
                minDistance = dist;
                nearestPoint = sp;
            }
        }
        return nearestPoint;
    }
     
    function drawVector(ctx, x1, y1, x2, y2) {
        if (x1 === x2 && y1 === y2) return;
        
        ctx.beginPath();
        ctx.arc(x1, y1, 4, 0, Math.PI * 2); 
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();

        const angle = Math.atan2(y2 - y1, x2 - x1);
        const arrowheadLength = 10;
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(
            x2 - arrowheadLength * Math.cos(angle - Math.PI / 6),
            y2 - arrowheadLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(x2, y2);
        ctx.lineTo(
            x2 - arrowheadLength * Math.cos(angle + Math.PI / 6),
            y2 - arrowheadLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
    }

    function drawButton(ctx, rect, color, text) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(rect.x, rect.y, rect.width, rect.height, [5]); 
        ctx.fill();
        
        ctx.fillStyle = 'black';
        ctx.font = BUTTON_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2);
    }
    
    function snapVectorComponents(start, end) {
        const vx = end.x - start.x;
        const vy = end.y - start.y;
        if (vx === 0 && vy === 0) return { vx: 0, vy: 0 };

        const angleRad = Math.atan2(vy, vx);
        const magnitude = Math.sqrt(vx * vx + vy * vy);
        
        const currentN = magnitude * FORCE_SCALE_FACTOR;
        const snapValueN = 0.5;
        const snappedN = Math.round(currentN / snapValueN) * snapValueN;
        
        const snappedMagnitude = snappedN / FORCE_SCALE_FACTOR;
        const snapAngle = Math.PI / 6.0; 
        const snappedAngleRad = Math.round(angleRad / snapAngle) * snapAngle;
        
        const snappedVX = snappedMagnitude * Math.cos(snappedAngleRad);
        const snappedVY = snappedMagnitude * Math.sin(snappedAngleRad);

        return {
            vx: snappedVX,
            vy: snappedVY
        };
    }
  
    function getDistance(p1, p2) {
        return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
    }
    
    function isPointInRect(p, rect) {
        return p.x >= rect.x && p.x <= rect.x + rect.width &&
               p.y >= rect.y && p.y <= rect.y + rect.height;
    }
    
     /** * マウス/タッチ座標を統一して取得する関数 
     * (getMousePos の代わりに使用)
     */
    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;

        // タッチイベントかどうか判定
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            // touchend の場合は changedTouches を参照
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else {
            // マウスイベント
            clientX = e.clientX;
            clientY = e.clientY;
        }

        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    // --- イベントリスナーの登録 (マウス & タッチ対応版) ---

    // 共通の開始処理 (mousedown / touchstart)
    function handleStart(e) {
        e.preventDefault(); // スクロール防止
        const p = getPos(e); // ★修正: getMousePos -> getPos
        currentMousePos = p;
        targetObject = null;
        isDrawingVector = false;

        if (isPointInRect(p, startButtonRect)) {
            startSimulation();
        } else if (isPointInRect(p, resetButtonRect)) {
            createObjectStates();
        } 
        else if (box1.collidesWith(p)) {
            isDrawingVector = true;
            targetObject = box1;
            vectorStartPos = getNearestSnapPoint(p, box1);
        } else if (box2.collidesWith(p)) {
            isDrawingVector = true;
            targetObject = box2;
            vectorStartPos = getNearestSnapPoint(p, box2);
        }
    }

    // 共通の終了処理 (mouseup / touchend)
    function handleEnd(e) {
        e.preventDefault();
        if (!isDrawingVector || !targetObject) {
            isDrawingVector = false;
            targetObject = null;
            return;
        }

        isDrawingVector = false;
        const endPos = getPos(e); // ★修正
        
        const snappedComponents = snapVectorComponents(vectorStartPos, endPos);
        const vx = snappedComponents.vx;
        const vy = snappedComponents.vy;
        
        if (Math.abs(vx) < 0.1 && Math.abs(vy) < 0.1) {
            targetObject = null;
            return;
        }
        
        const color = VECTOR_COLORS[0];

        const snappedMagnitude = Math.sqrt(vx * vx + vy * vy);
        const mag = snappedMagnitude * FORCE_SCALE_FACTOR;
        const magText = `${mag.toFixed(1)} N`;
        const snappedEndPosX = vectorStartPos.x + vx;
        const snappedEndPosY = vectorStartPos.y + vy;
        forceTextStamps.push(new ForceText(magText, { x: snappedEndPosX + 15, y: snappedEndPosY + 15 }));
        
        if (targetObject === box1) {
            box1Vectors.push(new ForceVector(vectorStartPos, vx, vy, color));
        } else if (targetObject === box2) {
            box2Vectors.push(new ForceVector(vectorStartPos, vx, vy, color));
        }
        
        targetObject = null;
    }

    // 共通の移動処理 (mousemove / touchmove)
    function handleMove(e) {
        e.preventDefault();
        currentMousePos = getPos(e); // ★修正
        
        const p = currentMousePos;
        if (isPointInRect(p, startButtonRect) || isPointInRect(p, resetButtonRect)) {
            canvas.style.cursor = 'pointer';
        } else {
            canvas.style.cursor = 'crosshair';
        }
    }

    // イベントの登録
    canvas.addEventListener('mousedown', handleStart, { passive: false });
    canvas.addEventListener('touchstart', handleStart, { passive: false });

    canvas.addEventListener('mouseup', handleEnd, { passive: false });
    canvas.addEventListener('touchend', handleEnd, { passive: false });

    canvas.addEventListener('mousemove', handleMove, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });
        
     /**
     * 指定されたタイプに対応する座標を返す（オフセット対応版）
     * 例: 'center', 'top+10' (Yに+10), 'center+10,-5' (Xに+10, Yに-5)
     */
    function getTargetPos(box, typeString) {
        const r = box.initialRect;
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;

        // 1. 文字列を「基本タイプ」と「オフセット部分」に分解する
        // 例: "top+12" -> type="top", offsetStr="+12"
        // 例: "center" -> type="center", offsetStr=""
        let type = typeString;
        let offsetX = 0;
        let offsetY = 0;

        // "+" または "-" が含まれているかチェック
        const match = typeString.match(/^([a-z]+)(.*)$/);
        if (match) {
            type = match[1]; // 'center', 'top' など
            const offsetPart = match[2]; // '+12', '+10,-5' など

            if (offsetPart) {
                if (offsetPart.includes(',')) {
                    // "x,y" 形式の場合 (例: +10,-5)
                    const parts = offsetPart.split(',');
                    offsetX = parseInt(parts[0], 10) || 0;
                    offsetY = parseInt(parts[1], 10) || 0;
                } else {
                    // 数値だけの場合 (例: +12) -> Y方向のオフセットとして扱う
                    offsetY = parseInt(offsetPart, 10) || 0;
                }
            }
        }

        // 2. 基本位置の決定
        let basePos = { x: cx, y: cy };
        switch (type) {
            case 'center': basePos = { x: cx, y: cy }; break;
            case 'top':    basePos = { x: cx, y: r.y }; break;
            case 'bottom': basePos = { x: cx, y: r.y + r.height }; break;
            case 'left':   basePos = { x: r.x, y: cy }; break;
            case 'right':  basePos = { x: r.x + r.width, y: cy }; break;
            default:       basePos = { x: cx, y: cy }; break;
        }

        // 3. オフセットを加算して返す
        return {
            x: basePos.x + offsetX,
            y: basePos.y + offsetY
        };
    }

    function gameLoop() {
        updateSimulation(); 
        drawSimulation();   
        requestAnimationFrame(gameLoop);
    }

    // --- 初期化と実行 ---
    createObjectStates(); 
    gameLoop();           

});