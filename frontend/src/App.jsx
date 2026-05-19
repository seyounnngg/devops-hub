import React from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import Dashboard from './Dashboard';
import CreateProject from './CreateProject';
import DeployProgress from './DeployProgress';
import DeploymentDetail from './DeploymentDetail';

// 랜딩 페이지 화면 (아까 만들었던 화면)
function LandingPage() {
  const navigate = useNavigate();

  const handleGitHubLogin = () => {
    // 실제 백엔드가 붙기 전이므로, 지금은 "로그인했다 치고" 대시보드로 이동시킵니다!
    alert("GitHub 로그인 연동 중... 대시보드로 이동합니다!");
    navigate('/dashboard');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '100px', fontFamily: 'sans-serif' }}>
      <h1>Handong Dev-Ops Hub</h1>
      <p style={{ textAlign: 'center', lineHeight: '1.5' }}>
        대학생 개발자를 위한 통합 자동 배포 플랫폼입니다.<br />
        GitHub 리포지토리를 연결하고 쉽게 배포를 완료하세요!
      </p>
      <button
        onClick={handleGitHubLogin}
        style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer', marginTop: '20px', backgroundColor: '#24292e', color: 'white', border: 'none', borderRadius: '5px' }}
      >
        GitHub로 로그인
      </button>
    </div>
  );
}

// 길 안내자 역할 (라우터)
function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 주소가 '/' (기본) 일 때는 LandingPage를 보여줌 */}
        <Route path="/" element={<LandingPage />} />
        {/* 주소가 '/dashboard' 일 때는 Dashboard를 보여줌 */}
        <Route path="/dashboard" element={<Dashboard />} />
        {/* '/create' 주소를 치면 CreateProject 페이지가 나오도록 설정 */}
        <Route path="/create" element={<CreateProject />} />
        {/*  /progress 주소 연결하기 */}
        <Route path="/progress" element={<DeployProgress />} />
        {/* /detail 주소 연결하기 */}
        <Route path="/detail" element={<DeploymentDetail />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;