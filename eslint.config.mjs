import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/playwright-report/**', '**/test-results/**', 'private/**', 'src/server/generated/prisma/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
)
