import globals from 'globals'

export default [
  {
    files: ['src/**/*.js', 'test/**/*.js', 'pretoken/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ],
      'no-undef': 'error',
      'no-console': 'warn'
    }
  }
]
