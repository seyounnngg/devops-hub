import React from 'react';
import { useNavigate } from 'react-router-dom';

function DeploymentDetail() {
    const navigate = useNavigate();

    return (
        <div style={{ padding: '40px', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto' }}>
            <h2>📄 배포 상세 정보 및 로그</h2>

            {/* 1. 상태 및 URL, Commit 정보 표시 영역 */}
            <div style={{ backgroundColor: '#e9f5ff', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #b8daff' }}>
                <h3 style={{ marginTop: 0 }}>상태: <span style={{ color: '#28a745' }}>✅ Success (Running)</span></h3>
                <p style={{ fontSize: '18px' }}>
                    <strong>🌐 접속 주소 (URL):</strong> <a href="#" style={{ color: '#007bff' }}>https://team3-web.devopshub.com</a>
                </p>
                <p style={{ color: '#555' }}>
                    <strong>📝 Commit 정보:</strong> [Update] 메인 페이지 UI 수정 (a1b2c3d)
                </p>
            </div>

            {/* 2. 터미널 느낌의 로그(Logs) 표시 영역 */}
            <div style={{
                backgroundColor: '#1e1e1e',
                color: '#00ff00',
                padding: '20px',
                borderRadius: '8px',
                height: '300px',
                overflowY: 'auto', // 내용이 길면 스크롤 생성
                fontFamily: 'monospace', // 타자기 폰트 (터미널 느낌)
                marginBottom: '20px',
                lineHeight: '1.6'
            }}>
                <div>[10:00:01] Cloning repository 'team-project-repo'...</div>
                <div>[10:00:05] Installing dependencies (npm install)...</div>
                <div>[10:00:15] Build successful.</div>
                <div>[10:00:18] Docker image created.</div>
                <div>[10:00:22] Container started on internal port 3000.</div>
                <div>[10:00:24] Nginx Reverse Proxy configured.</div>
                <div>[10:00:25] SSL Certificate (Let's Encrypt) applied.</div>
                <div style={{ color: 'white', marginTop: '10px', fontWeight: 'bold' }}>[10:00:26] ✨ Ready to serve traffic! ✨</div>
            </div>

            {/* 3. 액션 버튼 (Retry & Dashboard) */}
            <div style={{ display: 'flex', gap: '15px' }}>
                <button
                    onClick={() => alert('다시 배포를 시도합니다! (API 연동 대기 중)')}
                    style={{ padding: '10px 20px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '5px', fontSize: '16px', cursor: 'pointer' }}
                >
                    🔄 Retry (재배포)
                </button>
                <button
                    onClick={() => navigate('/dashboard')}
                    style={{ padding: '10px 20px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '5px', fontSize: '16px', cursor: 'pointer' }}
                >
                    대시보드로 돌아가기
                </button>
            </div>
        </div>
    );
}

export default DeploymentDetail;