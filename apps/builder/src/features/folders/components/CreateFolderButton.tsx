import { Button, HStack, Text } from '@chakra-ui/react'
import { FolderPlusIcon } from '@/components/icons'
import { useWorkspace } from '@/features/workspace/WorkspaceProvider'
import React from 'react'
import { useTranslate } from '@tolgee/react'

type Props = { isLoading: boolean; onClick: () => void }

export const CreateFolderButton = ({ isLoading, onClick }: Props) => {
  const { t } = useTranslate()
  const { workspace } = useWorkspace()

  const handleClick = () => {
    onClick()
  }

  return (
    <Button
      leftIcon={<FolderPlusIcon />}
      onClick={handleClick}
      isLoading={isLoading}
    >
      <HStack>
        <Text>{t('folders.createFolderButton.label')}</Text>
        {workspace?.plan === 'UNLIMITED' && <Text>{workspace.plan}</Text>}
      </HStack>
    </Button>
  )
}
