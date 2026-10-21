import { mkdirSync, writeFileSync } from 'node:fs'
import { NO_TRACES, podmanAvailable, seedUsers, startStack, stopStack, voteTraces } from './support/stack'

export default async function globalSetup() {
  if (!podmanAvailable()) {
    throw new Error('e2e tests need a running podman (podman machine start)')
  }

  const proxy = await startStack()
  const users = seedUsers(['Admin', 'Ann', 'Ben', 'Cat', 'Dan'], 'Admin')
  mkdirSync('e2e/.generated', { recursive: true })
  writeFileSync('e2e/.generated/users.json', JSON.stringify(users))

  // Teardown: the database must hold no trace of the test votes before it is destroyed.
  return async () => {
    try {
      const traces = voteTraces()
      if (traces !== NO_TRACES) throw new Error(`Vote traces remain after tests: ${traces}`)
    } finally {
      proxy.close()
      stopStack()
    }
  }
}
