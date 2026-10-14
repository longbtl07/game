const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json());

// Phục vụ giao diện web tĩnh khi đưa lên Render
app.use(express.static(__dirname));

// Khởi tạo SDK mới nhất của Google
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = process.env.MODEL_NAME || 'gemini-flash-lite-latest';

// Utility làm sạch và bóc tách JSON an toàn từ kết quả AI
const cleanJSON = (text) => {
    if (!text) return {};
    const unmarkdown = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const match = unmarkdown.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : unmarkdown);
};

// Kho dạng bài đa dạng cho từng kỹ năng (Tương thích 100% với UI hiện tại)
const TASK_POOL = {
    reading: [
        {
            type: 'TRUE_FALSE_NOT_GIVEN',
            instruction: 'Tạo 1-2 câu văn học thuật ngắn (25-35 từ) và 1 mệnh đề nhận định. options bắt buộc là ["TRUE", "FALSE", "NOT GIVEN"].'
        },
        {
            type: 'MULTIPLE_CHOICE',
            instruction: 'Tạo 1-2 câu văn (25-35 từ). Hỏi ý chính hoặc từ đồng nghĩa (Paraphrase). options gồm 3 lựa chọn ngắn gọn (dưới 6 từ mỗi lựa chọn).'
        },
        {
            type: 'SHORT_ANSWER',
            instruction: 'Dạng Gap-fill (Điền khuyết): Tạo 1-2 câu văn (25-35 từ). Câu hỏi là 1 câu tóm tắt có chỗ trống ký hiệu là [...]. Yêu cầu điền 1 từ (1 WORD ONLY).'
        },
        {
            type: 'SHORT_ANSWER',
            instruction: 'Dạng Tìm từ (Word Hunt): Tạo 1-2 câu văn (25-35 từ). Yêu cầu tìm đúng 1 từ trong đoạn văn đồng nghĩa với 1 từ cho sẵn (1 WORD ONLY).'
        }
    ],
    listening: [
        {
            type: 'SHORT_ANSWER',
            instruction: 'Dạng Note Completion: Tạo 1 thông báo/đoạn hội thoại tự nhiên (20-30 từ). Câu hỏi có chỗ trống [...] cần điền 1 từ hoặc 1 con số/giờ giấc (1 WORD/NUMBER).'
        },
        {
            type: 'MULTIPLE_CHOICE',
            instruction: 'Tạo 1 lời thoại ngắn (20-30 từ). Đặt câu hỏi ngắn gọn và cung cấp mảng options gồm 3 phương án ngắn (dưới 5 từ mỗi phương án).'
        }
    ],
    writing: [
        {
            type: 'REBUTTAL_WRITING',
            instruction: 'Dạng Phản biện: context là 1 nhận định cực đoan ngắn (10-15 từ). prompt yêu cầu viết 1 câu phản bác dùng từ nối (Although / However / While).'
        },
        {
            type: 'REBUTTAL_WRITING',
            instruction: 'Dạng Paraphrase: context là 1 câu đơn Band 5.0 (10-15 từ) kèm nhiệm vụ trong ngoặc. prompt yêu cầu viết lại câu đó dùng từ vựng Band 7.0+ hoặc cấu trúc câu ghép.'
        },
        {
            type: 'REBUTTAL_WRITING',
            instruction: 'Dạng Sửa lỗi (Fix the Sentence): context là 1 câu tiếng Anh có 1 lỗi ngữ pháp hoặc dùng từ sai rõ rệt. prompt yêu cầu học sinh viết lại câu hoàn chỉnh đã sửa lỗi.'
        }
    ],
    speaking: [
        {
            type: 'SPEAKING_PROMPT',
            instruction: 'Dạng Speaking Part 1: context ghi ngắn gọn "Gợi ý từ vựng: [cho 2-3 collocations ngắn]". prompt là 1 câu hỏi phản xạ gần gũi (8-12 từ).'
        }
    ]
};

// API 1: Sinh đề đa dạng & ngắn gọn
app.post('/api/generate-quest', async (req, res) => {
    try {
        const { skill } = req.body;
        const skillTasks = TASK_POOL[skill] || TASK_POOL.reading;
        const chosenTask = skillTasks[Math.floor(Math.random() * skillTasks.length)];

        const prompt = `Bạn là Game Master thiết kế câu hỏi IELTS ngắn gọn cho học sinh.
        Kỹ năng: "${skill}" | Loại UI: "${chosenTask.type}"
        Nhiệm vụ thiết kế: ${chosenTask.instruction}

        QUY TẮC CHỐNG NGỘP CHỮ (BẮT BUỘC):
        - "context": Cực ngắn (tối đa 35 từ), súc tích, đi thẳng vào trọng tâm.
        - "prompt": Chỉ dẫn siêu ngắn (tối đa 15 từ). Dùng từ ngữ trực diện, dễ hiểu.
        - "explanation": Giải thích tối đa 15 từ theo công thức "Từ A = Từ B" (VD: "'keep free of litter' = không có rác").
        - "hint": Gợi ý siêu ngắn dưới 8 từ.

        Trả về ĐÚNG JSON nguyên bản (không dùng markdown \`\`\`json):
        {
            "skill": "${skill}",
            "type": "${chosenTask.type}",
            "monster": "Tên quái vật ngắn (2-4 chữ)",
            "avatar": "1 emoji quái vật",
            "context": "...",
            "prompt": "...",
            "options": ["Phương án A", "Phương án B", "Phương án C"],
            "answer": ["đáp án chính", "từ đồng nghĩa 1", "từ đồng nghĩa 2"],
            "explanation": "...",
            "hint": "...",
            "time": 45
        }`;

        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                responseMimeType: "application/json"
            }
        });

        const quest = cleanJSON(response.text);
        res.json({ success: true, quest });
    } catch (error) {
        console.error('Lỗi sinh đề:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API 2: Chấm Writing súc tích, dễ hiểu
app.post('/api/evaluate-writing', async (req, res) => {
    try {
        const { userText, context, prompt: questPrompt } = req.body;
        const prompt = `Bạn là giám khảo IELTS chấm câu ngắn cho học sinh.
        Đề bài: "${context}" ${questPrompt ? `- Yêu cầu: "${questPrompt}"` : ''}
        Bài làm của học sinh: "${userText}"

        QUY TẮC CHẤM:
        - Chấp nhận cho qua (isPassed: true) nếu câu đúng ngữ pháp cơ bản và giải quyết đúng yêu cầu đề bài.
        - Nhận xét (feedback) bằng tiếng Việt, xưng hô thân thiện, ĐỘ DÀI TỐI ĐA 1 CÂU (dưới 20 từ).
        - Nếu sai: Chỉ thẳng vị trí sai và cách sửa ngắn gọn (VD: "Sai chia động từ 'causes', hãy sửa thành 'cause'.").

        Trả về ĐÚNG JSON nguyên bản (không dùng markdown):
        {
            "isPassed": true,
            "feedback": "1 câu nhận xét cực ngắn gọn",
            "damage": 0
        }
        (Nếu isPassed là false thì đặt damage: 25)`;

        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                responseMimeType: "application/json"
            }
        });

        const evaluation = cleanJSON(response.text);
        res.json({ success: true, evaluation });
    } catch (error) {
        console.error('Lỗi chấm Writing:', error);
        res.status(500).json({
            success: false,
            evaluation: { isPassed: false, feedback: 'Lỗi kết nối AI Giám khảo.', damage: 15 }
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Avalon Backend đang chạy tại http://localhost:${PORT}`);
});