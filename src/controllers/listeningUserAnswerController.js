import mongoose from "mongoose";
import moment from "moment";
import ListeningUserAnswer from "../models/listeningUserAnswerModel.js";
import ListeningQuestion from "../models/listeningQuestionModel.js";
import ListeningSection from "../models/listeningSectionModel.js";
import { sendBadRequestResponse, sendSuccessResponse } from "../utils/ResponseUtils.js";
import { ThrowError } from "../utils/ErrorUtils.js";


export const checkAndSubmitListeningAnswers = async (req, res) => {
    try {
        const { userId, listeningSectionId, questionId, userAnswer, answers } = req.body;

        // ✅ Validate IDs
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return sendBadRequestResponse(res, "Valid userId is required");
        }
        if (!listeningSectionId || !mongoose.Types.ObjectId.isValid(listeningSectionId)) {
            return sendBadRequestResponse(res, "Valid listeningSectionId is required");
        }

        const listeningSection = await ListeningSection.findById(listeningSectionId);
        if (!listeningSection) {
            return sendBadRequestResponse(res, "Listening Section not found!");
        }

        // 🔁 Helper: check and prepare one answer
        const processAnswer = async (questionId, userAnswer) => {
            if (!mongoose.Types.ObjectId.isValid(questionId)) {
                throw new Error("Invalid questionId");
            }

            const question = await ListeningQuestion.findById(questionId);
            if (!question) {
                throw new Error("Question not found");
            }

            // Normalize userAnswer
            let userAns = userAnswer;
            if (Array.isArray(userAns)) userAns = userAns.join(" ");
            else if (userAns !== null && typeof userAns !== 'string') userAns = String(userAns);
            userAns = userAns.trim().toLowerCase();

            // Normalize correctAnswer(s)
            let correctAnswer = question.answer;
            if (correctAnswer !== null && !Array.isArray(correctAnswer)) {
                correctAnswer = [correctAnswer];
            }

            if (
                Array.isArray(correctAnswer) &&
                correctAnswer.length === 1 &&
                typeof correctAnswer[0] === "string" &&
                correctAnswer[0].startsWith("[") &&
                correctAnswer[0].endsWith("]")
            ) {
                try {
                    const parsed = JSON.parse(correctAnswer[0]);
                    if (Array.isArray(parsed)) {
                        correctAnswer = parsed;
                    }
                } catch (e) {
                    // continue with raw string
                }
            }

            const isCorrect = correctAnswer.some(ansStr =>
                userAns === String(ansStr).trim().toLowerCase()
            );

            return {
                questionId,
                userAnswer: userAns,
                correctAnswer,
                isCorrect
            };
        };

        // 🔄 Find or create user answer doc
        let userSectionAnswer = await ListeningUserAnswer.findOne({ userId, listeningSectionId });
        if (!userSectionAnswer) {
            userSectionAnswer = new ListeningUserAnswer({
                userId,
                listeningSectionId,
                answers: []
            });
        }

        const finalAnswers = [];

        // 🔹 CASE 1: Multiple answers (full section)
        if (Array.isArray(answers) && answers.length > 0) {
            for (const ans of answers) {
                if (!ans.questionId || ans.userAnswer === undefined) {
                    return sendBadRequestResponse(res, "Each answer must have questionId and userAnswer!");
                }

                const answerObj = await processAnswer(ans.questionId, ans.userAnswer);
                const idx = userSectionAnswer.answers.findIndex(
                    a => a.questionId.toString() === ans.questionId
                );

                if (idx !== -1) userSectionAnswer.answers[idx] = answerObj;
                else userSectionAnswer.answers.push(answerObj);

                finalAnswers.push(answerObj);
            }
        }

        // 🔹 CASE 2: Single answer
        else if (questionId && userAnswer !== undefined) {
            const answerObj = await processAnswer(questionId, userAnswer);
            const idx = userSectionAnswer.answers.findIndex(
                a => a.questionId.toString() === questionId
            );

            if (idx !== -1) userSectionAnswer.answers[idx] = answerObj;
            else userSectionAnswer.answers.push(answerObj);

            finalAnswers.push(answerObj);
        } else {
            return sendBadRequestResponse(res, "Provide either (questionId & userAnswer) or answers array!");
        }

        await userSectionAnswer.save();

        return sendSuccessResponse(res, "Answer(s) submitted and checked!", {
            userId,
            listeningSectionId,
            answers: finalAnswers
        });

    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};

export const getAllListeningTestResults = async (req, res) => {
    try {
        const userId = req.user._id;

        const userTestAttempts = await ListeningUserAnswer.find({ userId })
            .sort({ createdAt: -1 })
            .populate('listeningSectionId', 'title'); // assumes title field exists

        if (!userTestAttempts || userTestAttempts.length === 0) {
            return sendSuccessResponse(res, "No tests found", []);
        }

        const results = await Promise.all(
            userTestAttempts.map(async (test, index) => {
                const totalQuestions = await ListeningQuestion.countDocuments({
                    listeningSectionId: test.listeningSectionId._id
                });

                const correctAnswers = test.answers.filter(ans => ans.isCorrect).length;
                const percentage = Math.round((correctAnswers / totalQuestions) * 100);

                let status = "Poor";
                if (percentage >= 80) status = "Excellent";
                else if (percentage >= 60) status = "Good";
                else if (percentage >= 40) status = "Average";

                return {
                    testNumber: `Practice Test-${userTestAttempts.length - index}`, // latest is highest number
                    listeningSectionId: test.listeningSectionId._id,
                    testDate: moment(test.createdAt).format("D, MMMM"),
                    percentage,
                    status
                };
            })
        );

        return sendSuccessResponse(res, "All Listening Test Results", results);
    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};