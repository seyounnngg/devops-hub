import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function CreateProject() {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);

    // ⭐ 추가된 마법: 어떤 서비스 타입을 선택했는지 기억하는 변수 (기본값은 'web')
    const [serviceType, setServiceType] = useState('web');

    const nextStep = () => setStep(step + 1);
    const prevStep = () => setStep(step - 1);

    // 카드 모양 버튼의 스타일을 미리 만들어둡니다. (선택된 카드는 파란색 테두리)
    const getCardStyle = (type) => ({
        padding: '20px',
        border: serviceType === type ? '2px solid #007bff' : '1px solid #ccc',
        borderRadius: '8px',
        cursor: 'pointer',
        width: '45%',
        textAlign: 'center',
        marginBottom: '10px',
        backgroundColor: serviceType === type ? '#e9f5ff' : 'white'
    });

    return (
        <div style={{ padding: '40px', fontFamily: 'sans-serif' }}>
            <h2>🚀 새 프로젝트 배포 설정 (단계: {step}/4)</h2>

            <div style={{ border: '1px solid #ccc', padding: '30px', borderRadius: '8px', maxWidth: '600px' }}>

                {/* STEP 1: 프로젝트 이름 */}
                {step === 1 && (
                    <div>
                        <h3>STEP 1. 프로젝트 이름 입력</h3>
                        <p>멋진 프로젝트 이름을 지어주세요.</p>
                        <input type="text" placeholder="예: my-awesome-web" style={{ padding: '10px', width: '90%', fontSize: '16px' }} />
                    </div>
                )}

                {/* STEP 2: GitHub 연동 */}
                {step === 2 && (
                    <div>
                        <h3>STEP 2. GitHub 리포지토리 선택</h3>
                        <select style={{ padding: '10px', width: '95%', fontSize: '16px', marginBottom: '15px' }}>
                            <option>team-project-repo</option>
                            <option>capstone-frontend</option>
                        </select>
                        <input type="text" placeholder="Branch (예: main)" defaultValue="main" style={{ padding: '10px', width: '90%', fontSize: '16px' }} />
                    </div>
                )}

                {/* ⭐ STEP 3: 서비스 타입 선택 카드 */}
                {step === 3 && (
                    <div>
                        <h3>STEP 3. 서비스 타입 선택</h3>
                        <p>어떤 종류의 프로젝트인가요?</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'space-between' }}>
                            <div style={getCardStyle('web')} onClick={() => setServiceType('web')}>🌐 Web Service</div>
                            <div style={getCardStyle('apk')} onClick={() => setServiceType('apk')}>📱 APK Build</div>
                            <div style={getCardStyle('function')} onClick={() => setServiceType('function')}>⚡ Function</div>
                            <div style={getCardStyle('cron')} onClick={() => setServiceType('cron')}>⏰ Cron Job</div>
                        </div>
                    </div>
                )}

                {/* ⭐ STEP 4: 서비스 타입에 따라 바뀌는 상세 설정 화면 */}
                {step === 4 && (
                    <div>
                        <h3>STEP 4. 세부 설정</h3>

                        {serviceType === 'web' && (
                            <div>
                                <p>프레임워크 선택:</p>
                                <select style={{ padding: '10px', width: '100%', marginBottom: '10px' }}>
                                    <option>Next.js</option>
                                    <option>React</option>
                                    <option>Spring Boot</option>
                                    <option>Flask</option>
                                </select>
                                <p>빌드 명령어 (Build Command):</p>
                                <input type="text" placeholder="npm run build" style={{ padding: '10px', width: '95%', marginBottom: '10px' }} />
                                <p>시작 명령어 (Start Command):</p>
                                <input type="text" placeholder="npm start" style={{ padding: '10px', width: '95%' }} />
                            </div>
                        )}

                        {serviceType === 'apk' && (
                            <div>
                                <p>모바일 프레임워크 선택:</p>
                                <select style={{ padding: '10px', width: '100%' }}>
                                    <option>Flutter</option>
                                    <option>React Native</option>
                                </select>
                            </div>
                        )}

                        {serviceType === 'function' && (
                            <div>
                                <p>런타임 환경 (Runtime):</p>
                                <select style={{ padding: '10px', width: '100%', marginBottom: '10px' }}>
                                    <option>Node.js</option>
                                    <option>Python</option>
                                </select>
                                <p>핸들러 파일명 (Handler File):</p>
                                <input type="text" placeholder="handler.js" style={{ padding: '10px', width: '95%' }} />
                            </div>
                        )}

                        {serviceType === 'cron' && (
                            <div>
                                <p>스크립트 경로 (Script Path):</p>
                                <input type="text" placeholder="./scripts/daily_crawler.py" style={{ padding: '10px', width: '95%', marginBottom: '10px' }} />
                                <p>실행 주기 (Schedule - Cron 표현식):</p>
                                <input type="text" placeholder="0 0 * * * (매일 자정)" style={{ padding: '10px', width: '95%' }} />
                            </div>
                        )}
                    </div>
                )}

                <hr style={{ margin: '30px 0' }} />

                {/* 하단 이전/다음 버튼 */}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    {step > 1 ? <button onClick={prevStep} style={{ padding: '10px 20px', cursor: 'pointer' }}>이전</button> : <div></div>}
                    {step < 4 ? (
                        <button onClick={nextStep} style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>다음</button>
                    ) : (
                        // 마지막 단계에서 배포하기 버튼 클릭 시 동작 임시 연결
                            <button onClick={() => navigate('/progress')} style={{ padding: '10px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>🚀 배포 시작!</button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default CreateProject;