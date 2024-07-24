import { Seo } from '@/components/Seo'
// import { useUser } from '@/features/account/hooks/useUser'
import { useWorkspace } from '@/features/workspace/WorkspaceProvider'
import { Stack, VStack, Spinner, Text } from '@chakra-ui/react'
import { useState, useEffect } from 'react'
import { DashboardHeader } from './DashboardHeader'
import { FolderContent } from '@/features/folders/components/FolderContent'
import { TypebotDndProvider } from '@/features/folders/TypebotDndProvider'
import { useTranslate } from '@tolgee/react'

export const DashboardPage = () => {
  const { t } = useTranslate()
  const [isLoading, setIsLoading] = useState(false)
  const { workspace } = useWorkspace()

  useEffect(() => {
    setIsLoading(false)
  }, [])

  return (
    <Stack minH="100vh">
      <Seo title={workspace?.name ?? t('dashboard.title')} />
      <DashboardHeader />
      <TypebotDndProvider>
        {isLoading ? (
          <VStack w="full" justifyContent="center" pt="10" spacing={6}>
            <Text>{t('dashboard.redirectionMessage')}</Text>
            <Spinner />
          </VStack>
        ) : (
          <FolderContent folder={null} />
        )}
      </TypebotDndProvider>
    </Stack>
  )
}
