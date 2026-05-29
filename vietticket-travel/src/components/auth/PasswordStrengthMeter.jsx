import { getPasswordStrength } from '../../utils/formValidators.js'

function PasswordStrengthMeter({ password }) {
  const strength = getPasswordStrength(password)
  const width = `${Math.min(strength.score, 5) * 20}%`

  return (
    <div className={`password-strength password-strength--${strength.className}`}>
      <div className="password-strength__track">
        <span style={{ width }} />
      </div>
      <p>Độ mạnh mật khẩu: {strength.label}</p>
    </div>
  )
}

export default PasswordStrengthMeter
