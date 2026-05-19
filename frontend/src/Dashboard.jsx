import React from 'react';
import { useNavigate } from 'react-router-dom'; // ⭐ 추가

function Dashboard() {
    const navigate = useNavigate(); // ⭐ 추가: 길 안내자 생성

    return (
        <div style={{ padding: '40px', fontFamily: 'sans-serif' }}>
            <h2>📊 내 프로젝트 대시보드</h2>

            <div style={{ border: '1px solid #ccc', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
                <h3>팀 프로젝트 웹사이트 (Web Service)</h3>
                <p>상태: <span style={{ color: 'green', fontWeight: 'bold' }}>Running (실행 중)</span></p>
                <p>URL: https://team3-web.devopshub.com</p>
            </div>

            {/* ⭐ 버튼에 onClick 추가: 누르면 '/create'로 이동 */}
            <button
                onClick={() => navigate('/create')}
                style={{ padding: '12px 24px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', fontSize: '16px', cursor: 'pointer' }}
            >
                + Create Project
            </button>
        </div>
    );
}

export default Dashboard;