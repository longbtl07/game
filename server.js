const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json());

// Khởi tạo SDK mới nhất của Google
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = 'gemini-flash-lite-latest';

/**
 * UTILITY: Dọn dẹp Markdown rác trước khi JSON.parse
 */
const cleanJSON = (text) => {
    return text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
};

/**
 * ENDPOINT 1: TẠO CÂU HỎI (GENERATE QUEST)
 */
app.post('/api/generate-quest', async (req, res) => {
    const { skill } = req.body;

    // Kỹ thuật Prompt Engineering: Định nghĩa Schema & Ràng buộc khắt khe
    const prompt = `
    Bạn là một chuyên gia ra đề thi IELTS Band 7.0+. Hãy tạo 1 câu hỏi/thử thách ngẫu nhiên cho kỹ năng "${skill}".
    Yêu cầu cấu trúc JSON trả về CHÍNH XÁC như sau, không chứa ký tự nào khác ngoài JSON:
    {
        "skill": "${skill}",
        "type": "SHORT_ANSWER hoặc TRUE_FALSE_NOT_GIVEN hoặc MULTIPLE_CHOICE hoặc REBUTTAL_WRITING hoặc SPEAKING_PROMPT",
        "monster": "Tên một con quái vật thần thoại (tiếng Việt, vd: Hắc Long Học Thuật)",
        "avatar": "1 Emoji phù hợp với quái vật",
        "context": "1 Đoạn văn học thuật (Reading) hoặc 1 Câu thoại (Listening) hoặc 1 Luận điểm sai logic (Writing) hoặc 1 Topic (Speaking). Nội dung bằng tiếng Anh.",
        "prompt": "Câu hỏi/Nhiệm vụ cho người chơi (tiếng Anh hoặc Việt).",
        "answer": ["Mảng chứa các chuỗi đáp án đúng (từ khóa hoặc T/F/NG)"],
        "explanation": "Giải thích chi tiết tại sao đáp án lại đúng (Tiếng Việt).",
        "hint": "1 Gợi ý ngắn gọn (Tiếng Việt).",
        "time": 45
    }
    
    Quy tắc bổ sung:
    - Nếu skill là "writing", type phải là "REBUTTAL_WRITING", answer chứa các từ nối tương phản (however, although...).
    - Nếu skill là "speaking", type phải là "SPEAKING_PROMPT".
    `;

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                responseMimeType: "application/json", // Ép trả về JSON format
            }
        });

        const rawText = response.text;
        const questData = JSON.parse(cleanJSON(rawText));
        
        res.json({ success: true, quest: questData });
    } catch (error) {
        console.error('Lỗi khi sinh đề:', error);
        res.status(500).json({ success: false, message: "Lỗi AI Server", error: error.message });
    }
});

/**
 * ENDPOINT 2: CHẤM ĐIỂM WRITING (EVALUATE WRITING)
 */
app.post('/api/evaluate-writing', async (req, res) => {
    const { userText, context } = req.body;

    const prompt = `
    Bạn là một Giám khảo IELTS vô cùng khắt khe. 
    Học sinh vừa phản hồi lại một luận điểm như sau:
    - Luận điểm gốc: "${context}"
    - Câu phản biện của học sinh: "${userText}"

    Hãy đánh giá câu phản biện của học sinh dựa trên Grammatical Range, Lexical Resource và tính Logic.
    Trả về ĐÚNG định dạng JSON sau:
    {
        "isPassed": true hoặc false (phải trên Band 6.5 mới cho pass),
        "feedback": "Nhận xét chi tiết bằng tiếng Việt về lỗi sai ngữ pháp, từ vựng hoặc khen ngợi nếu viết tốt.",
        "damage": 0 (nếu pass) hoặc 30 (nếu fail)
    }
    `;

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });

        const evaluation = JSON.parse(cleanJSON(response.text));
        res.json({ success: true, evaluation });
    } catch (error) {
        console.error('Lỗi khi chấm điểm:', error);
        res.status(500).json({ success: false, evaluation: { isPassed: false, feedback: "AI bị nghẽn mạng, không thể chấm điểm!", damage: 10 } });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Avalon Backend đang chạy tại http://localhost:${PORT}`);
});