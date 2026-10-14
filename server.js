const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files on Render
app.use(express.static(__dirname));

// Initialize Google GenAI SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = process.env.MODEL_NAME || 'gemini-flash-lite-latest';

// Utility to clean and extract valid JSON from model output
const cleanJSON = (text) => {
    if (!text) return {};
    const unmarkdown = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const match = unmarkdown.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : unmarkdown);
};

// Comprehensive task pool for all skills (English interface & strict format)
const TASK_POOL = {
    reading: [
        {
            type: 'TRUE_FALSE_NOT_GIVEN',
            instruction: 'Create 1-2 academic sentences (25-35 words) in "context", and 1 specific claim in "prompt". "options" MUST be exactly ["TRUE", "FALSE", "NOT GIVEN"].'
        },
        {
            type: 'MULTIPLE_CHOICE',
            instruction: 'Create 1-2 sentences (25-35 words) in "context". "prompt" is a direct question on main idea or paraphrase. "options" contains 3 concise choices (under 6 words each).'
        },
        {
            type: 'SHORT_ANSWER',
            instruction: 'Summary Gap-fill: "context" is 1-2 sentences (25-35 words). "prompt" MUST contain a summary sentence with a blank slot marked as "[...]" (e.g. "Complete summary: Exercise boosts blood [...] in the body. (1 WORD ONLY)"). "answer" is the single missing word.'
        },
        {
            type: 'SHORT_ANSWER',
            instruction: 'Word Hunt: "context" is 1-2 sentences (25-35 words). "prompt" MUST ask to locate 1 word from the text (e.g. "Find 1 word in the text that means \'ruined\' (1 WORD ONLY)."). "answer" is that exact word.'
        }
    ],
    listening: [
        {
            type: 'SHORT_ANSWER',
            instruction: 'Note Completion: "context" is a spoken announcement/dialogue (20-30 words) with clear facts. "prompt" MUST be a note with a blank marked as "[...]" (e.g. "Note: Flight to Tokyo departs at [...] (1 WORD/NUMBER)."). "answer" is 1 word or number.'
        },
        {
            type: 'MULTIPLE_CHOICE',
            instruction: 'Spoken Dialogue: "context" is 1 spoken dialogue (20-30 words). "prompt" is 1 question about what was said (under 12 words). "options" has 3 short choices.'
        }
    ],
    writing: [
        {
            type: 'REBUTTAL_WRITING',
            instruction: 'Rebuttal Challenge: "context" is an extreme statement (10-15 words). "prompt" is: "Write 1 sentence rebutting this using Although, However, or While."'
        },
        {
            type: 'REBUTTAL_WRITING',
            instruction: 'Paraphrase Challenge: "context" is a basic Band 5.0 sentence (10-15 words). "prompt" is: "Rewrite this sentence using advanced academic vocabulary or compound structure."'
        },
        {
            type: 'REBUTTAL_WRITING',
            instruction: 'Sentence Fix: "context" is a sentence with 1 obvious grammatical error. "prompt" is: "Rewrite the sentence with the grammatical error corrected."'
        }
    ],
    speaking: [
        {
            type: 'SPEAKING_PROMPT',
            instruction: 'Speaking Part 1: "context" is: "Vocabulary cues: [provide 2-3 natural collocations]". "prompt" is a direct conversation question (8-12 words).'
        }
    ]
};

// API 1: Generate Quest with linear Band difficulty and strict English formatting
app.post('/api/generate-quest', async (req, res) => {
    try {
        const { skill = 'reading', band = '4.0' } = req.body;
        const skillTasks = TASK_POOL[skill] || TASK_POOL.reading;
        const chosenTask = skillTasks[Math.floor(Math.random() * skillTasks.length)];

        const prompt = `You are an elite IELTS Dungeon Master designing a bite-sized RPG challenge.
Target Skill: "${skill}"
UI Type: "${chosenTask.type}"
Target IELTS Band Difficulty: "${band}" (Scale: 4.0 to 8.0)
Task Instruction: ${chosenTask.instruction}

DIFFICULTY SCALING RULES FOR BAND ${band}:
- Band 4.0 - 5.0: Elementary to pre-intermediate. Simple everyday vocabulary, basic syntax, direct matching.
- Band 5.5 - 6.5: Intermediate to upper-intermediate. Standard academic topics, compound sentences, simple synonyms.
- Band 7.0 - 8.0: Advanced academic. C1-C2 vocabulary, complex syntax, nuanced paraphrasing, subtle distractors.

STRICT MICRO-LEARNING RULES:
- Everything MUST BE IN ENGLISH (monster names, prompts, explanations, hints).
- "monster": Cool fantasy RPG monster name in English (2-3 words, e.g. "Shadow Drake", "Abyssal Viper", "Obsidian Sphinx", "Frost Golem").
- "avatar": 1 matching emoji.
- "context": Maximum 35 words. For Listening, this is the spoken script to be read aloud.
- "prompt": Maximum 20 words. CRITICAL: If the task is Gap-fill or Note Completion, "prompt" MUST include the target sentence with a blank slot marked as "[...]".
- "options": Array of 3 choices (or ["TRUE", "FALSE", "NOT GIVEN"]).
- "answer": Array of valid correct lowercase answers (e.g. ["circulation", "flow"]).
- "explanation": Maximum 15 words in English following formula "Keyword A = Keyword B" (e.g. "'depart' = leave").
- "hint": Under 8 words in English.
- "time": 40

Return ONLY raw JSON (no markdown \`\`\`json):
{
    "skill": "${skill}",
    "type": "${chosenTask.type}",
    "band": "${band}",
    "monster": "Shadow Drake",
    "avatar": "🐉",
    "context": "...",
    "prompt": "...",
    "options": ["Option A", "Option B", "Option C"],
    "answer": ["answer1", "synonym2"],
    "explanation": "...",
    "hint": "...",
    "time": 40
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
        console.error('Quest generation error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API 2: Evaluate Writing with concise English feedback
app.post('/api/evaluate-writing', async (req, res) => {
    try {
        const { userText, context, prompt: questPrompt, band = '4.0' } = req.body;
        const prompt = `You are a friendly IELTS Examiner grading a micro-writing challenge.
Target Band: "${band}"
Original Context: "${context}"
Task Prompt: "${questPrompt || ''}"
Student Response: "${userText}"

EVALUATION RULES:
- Give isPassed: true if the sentence has acceptable grammar and satisfies the prompt for Band ${band}.
- "feedback" MUST be in ENGLISH, friendly tone, MAXIMUM 1 SHORT SENTENCE (under 20 words).
- If incorrect: Point out the exact error and give the quick fix (e.g. "Change 'causes' to 'cause' to match plural subject.").

Return ONLY raw JSON:
{
    "isPassed": true,
    "feedback": "Concise 1-sentence feedback in English.",
    "damage": 0
}
(If isPassed is false, set damage: 25)`;

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
        console.error('Writing evaluation error:', error);
        res.status(500).json({
            success: false,
            evaluation: { isPassed: false, feedback: 'AI Examiner connection lost.', damage: 15 }
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Avalon Backend running at http://localhost:${PORT}`);
});