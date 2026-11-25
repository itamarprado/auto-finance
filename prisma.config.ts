import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env.PRISMA_INTROSPECTION_URL },
})
