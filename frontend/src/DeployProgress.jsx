import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function DeployProgress() {
    const navigate = useNavigate();
    // 현재 배포가 어디까지 진행되었는지 기억하는 숫자 (0부터 시작)
    const [currentStep, setCurrentStep] = useState(0);

    // 배포 단계 리스트
    const deploySteps = [
        "📦 Clone Repository (GitHub에서 코드 가져오는 중...)",
        "⚙️ Install Dependencies (필요한 패키지 설치 중...)",
        "🔨 Build (프로젝트 빌드 중...)",
        "🐳 Dockerize (도커 컨테이너 만드는 중...)",
        "🔒 Apply SSL (HTTPS 보안 적용 중...)",
        "✅ Deployment Complete (배포 완료!)"
    ];

    // 💡 마법의 훅(useEffect): 화면이 켜지면 자동으로 실행되는 타이머
    useEffect(() => {
        if (currentStep < deploySteps.length - 1) {
            const timer = setTimeout(() => {
                setCurrentStep((prev) => prev + 1); // 1.5초마다 다음 단계로 넘어감
            }, 1500);
            return () => clearTimeout(timer); // 타이머 청소
        }
    }, [currentStep, deploySteps.length]);

    return (
        <div style={{ padding: '40px', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h2>🚀 배포 진행 중...</h2>
            <p style={{ color: '#666' }}>화면을 벗어나지 마세요.</p>

            <div style={{ backgroundColor: '#f8f9fa', padding: '30px', borderRadius: '8px', width: '100%', maxWidth: '500px', marginTop: '20px' }}>
                {deploySteps.map((stepText, index) => (
                    <div key={index} style={{
                        padding: '10px 0',
                        fontSize: '16px',
                        // 현재 단계보다 이전이면 초록색, 현재 단계면 파란색 굵게, 아직 안 온 단계면 회색
                        color: index < currentStep ? 'green' : index === currentStep ? '#007bff' : '#ccc',
                        fontWeight: index === currentStep ? 'bold' : 'normal',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px'
                    }}>
                        {/* 상태 아이콘 표시 */}
                        <span>
                            {index < currentStep ? '✔️' : index === currentStep ? '⏳' : '⚪'}
                        </span>
                        {stepText}
                    </div>
                ))}
            </div>

            {/* 마지막 단계(배포 완료)에 도달하면 결과 확인 버튼 띄우기 */}
            {currentStep === deploySteps.length - 1 && (
                <button
                    onClick={() => navigate('/detail')}
                    style={{ padding: '12px 24px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '5px', fontSize: '16px', cursor: 'pointer', marginTop: '30px' }}
                >
                    배포 상세 정보 / 로그 보러가기 ➡️
                </button>
            )}
        </div>
    );
}

export default DeployProgress;