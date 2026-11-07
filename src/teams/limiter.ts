/** Returns a function running tasks with at most `limit` executing at once. */
export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const queue: (() => void)[] = []

  const next = (): void => {
    if (active >= limit) return
    const start = queue.shift()
    if (start) {
      active++
      start()
    }
  }

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      })
      next()
    })
}
