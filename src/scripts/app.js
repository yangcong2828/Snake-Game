console.log("JavaScript 文件加载成功！");
const gameBoard = document.getElementById("gameBoard");
const boardSize = 20;
const cells = [];
let snake = [{ x: Math.floor(boardSize / 2), y: Math.floor(boardSize / 2) }];
let direction = { x: 1, y: 0 }; // 默认向右移动
let food = { x: 5, y: 5 };
let gameInterval;
let isPaused = false; // 游戏是否暂停

// 初始化游戏网格
function createBoard() {
  for (let i = 0; i < boardSize; i++) {
    for (let j = 0; j < boardSize; j++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      gameBoard.appendChild(cell);
      cells.push(cell);
    }
  }
}

// 更新游戏网格
function updateBoard() {
  cells.forEach(cell => cell.className = "cell");
  snake.forEach(segment => {
    const index = segment.y * boardSize + segment.x;
    cells[index].classList.add("snake");
  });
  const foodIndex = food.y * boardSize + food.x;
  cells[foodIndex].classList.add("food");
}

// 移动蛇
function moveSnake() {
  const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

  // 检查碰撞
  if (
    head.x < 0 || head.x >= boardSize ||
    head.y < 0 || head.y >= boardSize ||
    snake.some(segment => segment.x === head.x && segment.y === head.y)
  ) {
    clearInterval(gameInterval);
    alert("游戏结束！");
    return;
  }

  snake.unshift(head);

  // 吃食物
  if (head.x === food.x && head.y === food.y) {
    placeFood();
  } else {
    snake.pop();
  }

  updateBoard();
}

// 放置食物
function placeFood() {
  let attempts = 0;
  do {
    food = {
      x: Math.floor(Math.random() * boardSize),
      y: Math.floor(Math.random() * boardSize),
    };
    attempts++;
  } while (snake.some(segment => segment.x === food.x && segment.y === food.y) && attempts < 100);

  if (attempts === 100) {
    alert("游戏结束！没有更多空间生成食物！");
    clearInterval(gameInterval);
  }
}

// 监听键盘输入
function handleKeydown(event) {
  switch (event.key) {
    case "ArrowUp":
      if (direction.y === 0) direction = { x: 0, y: -1 };
      break;
    case "ArrowDown":
      if (direction.y === 0) direction = { x: 0, y: 1 };
      break;
    case "ArrowLeft":
      if (direction.x === 0) direction = { x: -1, y: 0 };
      break;
    case "ArrowRight":
      if (direction.x === 0) direction = { x: 1, y: 0 };
      break;
  }
}

// 重新开始游戏
function restartGame() {
  clearInterval(gameInterval); // 停止当前游戏
  snake = [{ x: Math.floor(boardSize / 2), y: Math.floor(boardSize / 2) }]; // 重置蛇的位置
  direction = { x: 1, y: 0 }; // 重置方向
  placeFood(); // 重新放置食物
  updateBoard(); // 更新游戏网格
  isPaused = false; // 确保游戏未暂停
  gameInterval = setInterval(moveSnake, 200); // 重新开始游戏
}

// 暂停/继续游戏
function togglePause() {
  if (isPaused) {
    // 如果游戏已暂停，则继续游戏
    gameInterval = setInterval(moveSnake, 200);
    document.getElementById("pauseButton").innerText = "暂停";
  } else {
    // 如果游戏正在进行，则暂停游戏
    clearInterval(gameInterval);
    document.getElementById("pauseButton").innerText = "继续";
  }
  isPaused = !isPaused; // 切换暂停状态
}

// 初始化游戏
function startGame() {
  createBoard();
  updateBoard();
  document.addEventListener("keydown", handleKeydown);
  gameInterval = setInterval(moveSnake, 200);
}

startGame();