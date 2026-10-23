import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { AUTH_STORAGE_KEY, NO_TRACES, sessionFor, sql, voteTraces, type TestUser } from './support/stack'

const users: TestUser[] = JSON.parse(readFileSync('e2e/.generated/users.json', 'utf8'))
const ann = users.find((user) => user.name === 'Ann')!

test.afterAll(() => {
  sql('delete from public.votes')
  expect(voteTraces()).toBe(NO_TRACES)
})

test('mobile account menu and tab bar reach every view', async ({ page }) => {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [AUTH_STORAGE_KEY, JSON.stringify(sessionFor(ann))],
  )
  await page.goto('/')

  const tabs = page.getByRole('navigation', { name: 'Primary' })
  await expect(tabs.getByRole('button', { name: 'Clicker' })).toHaveCount(0)
  await tabs.getByRole('button', { name: 'Spooks' }).tap()
  await expect(page).toHaveURL(/\/spooks/)

  await tabs.getByRole('button', { name: 'Pass' }).tap()
  await expect(page).toHaveURL(/\/battlepass/)
  const account = page.getByRole('button', { name: 'Account' })
  await account.tap()
  await expect(account).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('menuitem', { name: 'Users' }).tap()
  await expect(page).toHaveURL(/\/users/)
  await expect(page.getByRole('menu')).toHaveCount(0)

  await account.tap()
  await page.getByRole('menuitem', { name: 'Profile' }).tap()
  await expect(page).toHaveURL(/\/profile/)

  await page.getByRole('button', { name: 'Spookify', exact: true }).first().tap()
  await expect(page).toHaveURL(/\/clicker/)
})

test('tapping a live chart bar reveals the user and costume', async ({ page }) => {
  sql(`
    with v as (insert into public.votes (category) values ('Scariest') returning id)
    insert into public.vote_participation (vote_id, user_id) select id, '${ann.id}' from v
  `)

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [AUTH_STORAGE_KEY, JSON.stringify(sessionFor(ann))],
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Poll', exact: true }).tap()

  const bars = page.getByTestId('vote-bar')
  await expect(bars).toHaveCount(3)
  await expect(bars.first()).toContainText('Costume #')

  await bars.first().tap()
  // The chart reorders on its own, so look at any bar rather than the tapped rank.
  await expect(bars.filter({ hasText: /costume$/ })).toHaveCount(1)
})
