export function getStudentNumberRegistrationFields(value) {
  if (typeof value !== 'string') return null
  const pendingStudentNumber = value.trim()
  if (!pendingStudentNumber || pendingStudentNumber.length > 80) return null

  return {
    student_number: null,
    pending_student_number: pendingStudentNumber,
  }
}
