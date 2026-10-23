import { readFileSync } from 'node:fs'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { AUTH_STORAGE_KEY, NO_TRACES, sessionFor, sql, voteTraces, type TestUser } from './support/stack'

const users: TestUser[] = JSON.parse(readFileSync('e2e/.generated/users.json', 'utf8'))
const byName = (name: string) => users.find((user) => user.name === name)!
const CATEGORY = 'Best costume'

const openAs = async (browser: Browser, name: string) => {
  const context: BrowserContext = await browser.newContext()
  const session = sessionFor(byName(name))
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [AUTH_STORAGE_KEY, JSON.stringify(session)],
  )
  const page = await context.newPage()
  page.on('dialog', (dialog) => void dialog.accept())
  await page.goto('/')
  return page
}

const goTo = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true }).click()

const vote = async (page: Page, candidate: string) => {
  await page.reload()
  await goTo(page, 'Poll')
  await page.getByRole('radio', { name: new RegExp(candidate) }).check()
  await page.getByRole('button', { name: 'Cast ballot' }).click()
  await expect(page.getByRole('status')).toContainText("You've voted")
}

test.afterAll(() => {
  sql('delete from public.votes')
})

test('anonymous vote from start to winner badges to deletion', async ({ browser }) => {
  const admin = await openAs(browser, 'Admin')
  const [ann, ben, cat, dan] = await Promise.all(['Ann', 'Ben', 'Cat', 'Dan'].map((name) => openAs(browser, name)))

  await test.step('members see no poll before a vote exists', async () => {
    await expect(ann.getByRole('button', { name: 'Poll', exact: true })).toHaveCount(0)
  })

  const startVote = async () => {
    await goTo(admin, 'Admin')
    await admin.getByLabel('Category').fill(CATEGORY)
    await admin.getByRole('button', { name: 'Start vote' }).click()
    await expect(admin.getByTestId('open-vote')).toContainText(CATEGORY)
  }

  await test.step('admin starts a vote', startVote)

  await test.step('the ballot offers everyone except yourself', async () => {
    await ann.reload()
    await goTo(ann, 'Poll')
    await expect(ann.getByTestId('vote-card')).toContainText(CATEGORY)
    await expect(ann.getByRole('radio')).toHaveCount(4)
    await expect(ann.getByRole('radio', { name: /Ann costume/ })).toHaveCount(0)
  })

  await test.step('a ballot counts once and progress rises', async () => {
    await vote(ann, 'Ben')
    await expect(admin.getByTestId('open-vote')).toContainText('1 of 5 voted', { timeout: 15000 })
    await expect(ann.getByTestId('vote-bar')).toHaveCount(3)
    await expect(ann.getByRole('radio')).toHaveCount(0)
  })

  await test.step('reset deletes the vote and every trace', async () => {
    await admin.getByRole('button', { name: 'Reset vote' }).click()
    await expect(admin.getByTestId('open-vote')).toHaveCount(0)
    expect(voteTraces()).toBe(NO_TRACES)
    await startVote()
  })

  await test.step('everybody votes once, the result is a tie', async () => {
    await vote(ann, 'Ben')
    await vote(ben, 'Ann')
    await vote(cat, 'Ben')
    await vote(dan, 'Ann')
    await expect(admin.getByTestId('open-vote')).toContainText('4 of 5 voted', { timeout: 15000 })
  })

  await test.step('admin ends the vote and winners are revealed', async () => {
    await admin.getByRole('button', { name: 'End vote' }).click()
    await expect(admin.getByTestId('open-vote')).toHaveCount(0)
    await cat.reload()
    await goTo(cat, 'Poll')
    await expect(cat.getByTestId('vote-card')).toHaveAttribute('data-status', 'ended')
    await expect(cat.locator('[data-testid="vote-bar"][data-winner="true"]')).toHaveCount(2)
    await expect(cat.getByTestId('vote-card')).toContainText('Ann costume')
    await expect(cat.getByTestId('vote-card')).toContainText('Ben costume')
  })

  await test.step('both winners get the badge, others do not', async () => {
    for (const page of [ann, ben]) {
      await page.reload()
      await goTo(page, 'Pass')
      await expect(page.getByTestId('winner-badge')).toContainText(`Gewinner von ${CATEGORY}`)
    }
    await cat.reload()
    await goTo(cat, 'Pass')
    await expect(cat.getByTestId('winner-badge')).toHaveCount(0)
  })

  await test.step('deleting the vote removes badges and all traces', async () => {
    await goTo(admin, 'Admin')
    await admin.getByRole('list', { name: 'Ended votes' }).getByRole('button', { name: 'Delete' }).click()
    await expect(admin.getByRole('list', { name: 'Ended votes' })).toHaveCount(0)
    expect(voteTraces()).toBe(NO_TRACES)
    await ann.reload()
    await goTo(ann, 'Pass')
    await expect(ann.getByTestId('winner-badge')).toHaveCount(0)
  })
})
