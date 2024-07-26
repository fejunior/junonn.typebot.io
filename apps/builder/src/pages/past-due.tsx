import { AlertIcon } from '@/components/icons'
import { DashboardHeader } from '@/features/dashboard/components/DashboardHeader'
import { useWorkspace } from '@/features/workspace/WorkspaceProvider'
import { Heading, VStack, Text } from '@chakra-ui/react'
import { useRouter } from 'next/router'
import { useEffect } from 'react'

export default function Page() {
  const { replace } = useRouter()
  const { workspace } = useWorkspace()

  useEffect(() => {
    if (!workspace) return
    replace('/typebots')
  }, [replace, workspace])

  return (
    <>
      <DashboardHeader />
      <VStack
        w="full"
        h="calc(100vh - 64px)"
        justifyContent="center"
        spacing={4}
      >
        <AlertIcon width="40px" />
        <Heading fontSize="2xl">Your workspace is ready!</Heading>
        <Text>
          Head over to the dashboard to start working with your Typebots.
        </Text>
      </VStack>
    </>
  )
}
