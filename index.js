const express = require('express');
const mysql = require('mysql2'); // DB 연결을 위한 라이브러리 추가
const app = express();
const port = 3000;

// 1. DB 접속 정보 입력
const connection = mysql.createConnection({
  host: 'handong-mysql', // 컨테이너 이름 사용!
  user: 'root',
  password: 'handong123!',
  database: 'handong_db'
});

// 2. DB 연결 테스트
connection.connect((err) => {
  if (err) {
    console.error('❌ DB 연결 실패: ' + err.stack);
    return;
  }
  console.log('✅ MySQL DB에 성공적으로 연결되었습니다! (ID: ' + connection.threadId + ')');
});

app.get('/', (req, res) => {
    res.send('<h1>Handong Dev-Ops Hub: Backend & DB 연결 성공 v2</h1>');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
