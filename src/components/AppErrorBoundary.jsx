import { Component } from 'react'

export default class AppErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-[100dvh] items-center justify-center bg-white px-6 text-center text-gray-900 dark:bg-[#121212] dark:text-white">
          <section className="max-w-sm">
            <h1 className="text-xl font-semibold">앱을 표시하지 못했습니다</h1>
            <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
              잠시 후 다시 시도해 주세요. 문제가 계속되면 운영진에게 알려 주세요.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-full bg-orange-500 px-6 py-3 text-sm font-semibold text-white"
            >
              다시 불러오기
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
