import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import questionService from '../services/questionService.js'

export default function PartnerQuestionsPage() {
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const unanswered = useMemo(
    () => questions.filter((item) => !item.answer).length,
    [questions],
  )

  const load = () => questionService.getPartnerQuestions()
    .then(setQuestions)
    .catch((error) => toast.error(error.message || 'Không thể tải câu hỏi.'))
    .finally(() => setIsLoading(false))

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const submitAnswer = async (item) => {
    const answer = String(answers[item.id] ?? item.answer ?? '').trim()
    if (answer.length < 5) {
      toast.warning('Câu trả lời cần ít nhất 5 ký tự.')
      return
    }
    setSavingId(item.id)
    try {
      await questionService.answerPartnerQuestion(item.id, answer)
      setQuestions((current) => current.map((question) => (
        question.id === item.id ? { ...question, answer, answeredAt: new Date().toISOString() } : question
      )))
      toast.success('Đã đăng câu trả lời.')
    } catch (error) {
      toast.error(error.message || 'Không thể đăng câu trả lời.')
    } finally {
      setSavingId('')
    }
  }

  return (
    <PartnerLayout pageTitle="Hỏi & đáp">
      <div className="rounded-2xl bg-gradient-to-r from-[#00474d] to-[#136870] p-6 text-white">
        <h2 className="text-2xl font-bold">Câu hỏi từ du khách</h2>
        <p className="mt-1 text-sm text-[#c7eef0]">{unanswered} câu hỏi đang chờ phản hồi</p>
      </div>
      {isLoading ? (
        <p className="py-12 text-center font-semibold text-[#526163]">Đang tải câu hỏi...</p>
      ) : questions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#bec8ca] bg-white p-10 text-center text-[#6f797a]">
          Chưa có câu hỏi nào.
        </p>
      ) : (
        <div className="space-y-4">
          {questions.map((item) => (
            <article className="rounded-2xl border border-[#d7e4e5] bg-white p-5 shadow-sm" key={item.id}>
              <p className="text-xs font-bold uppercase text-primary">{item.attraction?.title}</p>
              <h3 className="mt-2 font-bold text-[#1a1c1e]">{item.question}</h3>
              <p className="mt-1 text-xs text-[#6f797a]">Khách hỏi: {item.user?.fullName}</p>
              <textarea
                className="mt-4 w-full rounded-xl border border-[#bec8ca] p-4 text-sm"
                maxLength={2000}
                onChange={(event) => setAnswers((current) => ({
                  ...current,
                  [item.id]: event.target.value,
                }))}
                placeholder="Nhập câu trả lời rõ ràng, hữu ích..."
                rows={3}
                value={answers[item.id] ?? item.answer ?? ''}
              />
              <div className="mt-3 text-right">
                <button
                  className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  disabled={savingId === item.id}
                  onClick={() => void submitAnswer(item)}
                  type="button"
                >
                  {savingId === item.id ? 'Đang lưu...' : item.answer ? 'Cập nhật trả lời' : 'Đăng trả lời'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </PartnerLayout>
  )
}
