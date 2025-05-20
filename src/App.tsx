import {useRef, useState} from 'react';
import { GoogleGenAI, createUserContent, createPartFromUri } from '@google/genai';
import {endPromt, startPromt} from "./prompt.ts";


import { Type } from '@google/genai';
import {main, members} from "./mock.ts";

// Схема для поведенческих индикаторов
const indicatorSchema = {
    type: Type.OBJECT,
    properties: {
        detected: { type: Type.BOOLEAN },
        examples: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    quote: { type: Type.STRING },
                    timestamp: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    context: { type: Type.STRING } // Только для перебивания
                },
                required: ['quote', 'timestamp', 'explanation']
            }
        }
    },
    required: ['detected', 'examples']
};

// Основная схема ответа
const responseSchema = {
    type: Type.OBJECT,
    properties: {
        // meeting_summary: {
        //     type: Type.OBJECT,
        //     properties: {
        //         topic: { type: Type.STRING },
        //         atmosphere: { type: Type.STRING },
        //         key_points: {
        //             type: Type.ARRAY,
        //             items: { type: Type.STRING }
        //         },
        //         conflicts: {
        //             type: Type.ARRAY,
        //             items: { type: Type.STRING }
        //         }
        //     },
        //     required: ['topic', 'atmosphere', 'key_points']
        // },
        // transcript: {
        //     type: Type.ARRAY,
        //     items: {
        //         type: Type.OBJECT,
        //         properties: {
        //             start_time: { type: Type.STRING },
        //             end_time: { type: Type.STRING },
        //             speaker: { type: Type.STRING },
        //             text: { type: Type.STRING }
        //         },
        //         required: ['start_time', 'end_time', 'speaker', 'text']
        //     }
        // },
        participants_analysis: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING },
                    behavior_summary: { type: Type.STRING },
                    indicators: {
                        type: Type.OBJECT,
                        properties: {
                            resentment: indicatorSchema,
                            justification: indicatorSchema,
                            defense: indicatorSchema,
                            interruption: {
                                ...indicatorSchema,
                                properties: {
                                    ...indicatorSchema.properties,
                                    examples: {
                                        type: Type.ARRAY,
                                        items: {
                                            ...indicatorSchema.properties.examples.items,
                                            properties: {
                                                ...indicatorSchema.properties.examples.items.properties,
                                                context: { type: Type.STRING }
                                            },
                                            required: [...indicatorSchema.properties.examples.items.required, 'context']
                                        }
                                    }
                                }
                            },
                            agreement: indicatorSchema,
                            vanity: indicatorSchema,
                            feigned_interest: indicatorSchema
                        }
                    }
                },
                required: ['name', 'behavior_summary', 'indicators']
            }
        }
    },
    required: [ 'participants_analysis']
};



const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_APP_GEMINI_KEY });

// const parseTimeToSeconds = (timeString: string) => {
//     const match = timeString.match(/^(\d+):(\d{2})$/);
//     if (!match) return 0;
//     const [, min, sec] = match;
//     return Number(min) * 60 + Number(sec);
// };



function parseTimeToSeconds(timeString: string): number {
    // Проверяем формат строки с помощью регулярного выражения
    const timeRegex = /^(?:([0-1]?[0-9]|2[0-3]):)?([0-5][0-9]):([0-5][0-9])$/;

    if (!timeRegex.test(timeString)) {
        throw new Error('Invalid time format. Expected HH:MM:SS or MM:SS');
    }

    // Разбиваем строку на компоненты
    const parts = timeString.split(':');

    // В зависимости от количества частей определяем формат
    if (parts.length === 3) {
        // Формат HH:MM:SS
        const [hours, minutes, seconds] = parts.map(Number);
        return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
        // Формат MM:SS
        const [minutes, seconds] = parts.map(Number);
        return minutes * 60 + seconds;
    } else {
        throw new Error('Invalid time format. Expected HH:MM:SS or MM:SS');
    }
}


const App = () => {
    const [mainAudio, setMainAudio] = useState(null);
    const [participants, setParticipants] = useState([]);
    const [analysisResult, setAnalysisResult] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [audioUrl, setAudioUrl] = useState()
    const audioRef = useRef<HTMLAudioElement>(null);


    // Загрузка основного аудио
    const handleMainFile = (e) => {
        setMainAudio(e.target.files[0]);
    };

    // Добавление участника
    const addParticipant = () => {
        setParticipants([...participants, { name: '', file: null }]);
    };

    // Обновление данных участника
    const updateParticipant = (index, field, value) => {
        const updated = participants.map((p, i) =>
            i === index ? { ...p, [field]: value } : p
        );
        setParticipants(updated);
    };

    // Отправка анализа
    const analyzeMeeting = async () => {

        setAudioUrl(URL.createObjectURL(mainAudio))
        setIsLoading(true);

        try {
            // 1. Загрузка основного аудио
            const mainFile = await ai.files.upload({
                file: mainAudio,
                config: { mimeType: mainAudio.type }
            });
            // const mainFile = main

            // 2. Загрузка образцов участников
            const participantUploads = await Promise.all(
                participants
                    .filter(p => p.file) // Фильтруем участников без файлов
                    .map(async (participant) => {
                        const uploadedFile = await ai.files.upload({
                            file: participant.file,
                            config: {
                                mimeType: participant.file.type,
                                displayName: participant.name
                            }
                        });
                        return {
                            name: participant.name,
                            uri: uploadedFile.uri,
                            mimeType: uploadedFile.mimeType
                        };
                    })
            );

            // const participantUploads = members

            console.log(JSON.stringify(mainFile), "mainFile")

            console.log(JSON.stringify(participantUploads), "members")

            // 3. Формирование промпта
            const promptParts = [
                startPromt,
                "Основная аудиозапись совещания:",
                createPartFromUri(mainFile.uri, mainFile.mimeType),
                "Аудиозаписи с образцами голоса участников:",
                ...participantUploads.flatMap(p => [
                    `Участник: ${p.name}`,
                    createPartFromUri(p.uri, p.mimeType)
                ]),
                endPromt
            ];


            // 4. Отправка запроса
            const response = await ai.models.generateContent({
                model: "gemini-2.5-pro-preview-05-06",
                contents: createUserContent(promptParts),

                config: {
                    responseMimeType: 'application/json',
                    responseSchema: responseSchema,
                    temperature: 1
                },
            });

            // 5. Обработка результата
            const result = JSON.parse(response.text);
            setAnalysisResult(result)

            console.log(response)
            console.log(result)

        } catch (error) {
            console.error("Analysis error:", error);
            setAnalysisResult(`Ошибка анализа: ${error.message}`);
        }
        setIsLoading(false);
    };

    const handleTimeClick = (timeString: string) => {
        console.log(timeString)
        if (!audioRef.current) return;
        const seconds = parseTimeToSeconds(timeString);
        console.log(seconds)
        audioRef.current.currentTime = seconds;
        audioRef.current.play();
    };

    console.log(analysisResult)

    return (
        <div className="container">
            <h1>Анализатор совещаний с Gemini</h1>

            {/* Загрузка основного аудио */}
            <div className="section">
                <h3>Основное аудио совещания</h3>
                <input
                    type="file"
                    accept="audio/*"
                    onChange={handleMainFile}
                />
            </div>

            {/* Участники с образцами голоса */}
            <div className="section">
                <h3>Участники</h3>
                <button onClick={addParticipant}>+ Добавить участника</button>

                {participants.map((p, index) => (
                    <div key={index} className="participant">
                        <input
                            type="text"
                            placeholder="Имя участника"
                            value={p?.name}
                            onChange={(e) => updateParticipant(index, 'name', e.target.value)}
                        />
                        <input
                            type="file"
                            accept="audio/*"
                            onChange={(e) => updateParticipant(index, 'file', e.target.files[0])}
                        />
                    </div>
                ))}
            </div>

            {/* Кнопка анализа */}
            <button
                onClick={analyzeMeeting}
                disabled={isLoading}
            >
                {isLoading ? 'Анализ...' : 'Начать анализ'}
            </button>

            {/* Результаты */}
            <div style={{ maxWidth: 700, margin: "0 auto", fontFamily: "sans-serif" }}>
                <h1>Анализ аудиосовещания с тайм-кодами</h1>
                {audioUrl && <audio ref={audioRef} controls src={audioUrl} style={{width: "100%", marginBottom: 30}}/>}

                {analysisResult?.participants_analysis?.map((participant) => (
                    <div key={participant.name} style={{ marginBottom: 32, padding: 16, border: "1px solid #eee", borderRadius: 8 }}>
                        <h2>{participant.name}</h2>
                        <p style={{ fontStyle: "italic", color: "#555" }}>{participant.behavior_summary}</p>
                        {Object.entries(participant.indicators).map(([indicator, data]) =>
                            (data as any).detected && (data as any).examples.length > 0 ? (
                                <div key={indicator} style={{ marginTop: 15 }}>
                                    <h3 style={{ marginBottom: 6 }}>{indicator}</h3>
                                    {(data as any).examples.map((example: any, idx: number) => (
                                        <div
                                            key={idx}
                                            style={{
                                                background: "#f9f9f9",
                                                borderRadius: 6,
                                                padding: "8px 12px",
                                                marginBottom: 8,
                                                cursor: "pointer",
                                                border: "1px solid #e0e0e0"
                                            }}
                                            onClick={() => handleTimeClick(example.timestamp)}
                                            title="Перемотать аудио к этому моменту"
                                        >
                                            <b>Цитата:</b> "{example.quote}"<br />
                                            <b>Время:</b> <span style={{ color: "#1976d2", textDecoration: "underline" }}>{example.timestamp}</span><br />
                                            <b>Пояснение:</b> {example.explanation}
                                        </div>
                                    ))}
                                </div>
                            ) : null
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default App;
