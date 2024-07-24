import React from 'react'
import { BlockIcon } from './BlockIcon'
import { BlockLabel } from './BlockLabel'
import { useTranslate } from '@tolgee/react'
import { BubbleBlockType } from '@typebot.io/schemas/features/blocks/bubbles/constants'
import { InputBlockType } from '@typebot.io/schemas/features/blocks/inputs/constants'
import { IntegrationBlockType } from '@typebot.io/schemas/features/blocks/integrations/constants'
import { LogicBlockType } from '@typebot.io/schemas/features/blocks/logic/constants'
import { BlockV6 } from '@typebot.io/schemas'
import { BlockCardLayout } from './BlockCardLayout'
import { ForgedBlockCard } from '@/features/forge/ForgedBlockCard'
import { isForgedBlockType } from '@typebot.io/schemas/features/blocks/forged/helpers'

type Props = {
  type: BlockV6['type']
  tooltip?: string
  isDisabled?: boolean
  children: React.ReactNode
  onMouseDown: (e: React.MouseEvent, type: BlockV6['type']) => void
}

export const BlockCard = (
  props: Pick<Props, 'type' | 'onMouseDown'>
): JSX.Element => {
  const { t } = useTranslate()

  if (isForgedBlockType(props.type)) {
    return <ForgedBlockCard type={props.type} onMouseDown={props.onMouseDown} />
  }

  const renderBlockCardLayout = (tooltip: string) => (
    <BlockCardLayout {...props} tooltip={tooltip}>
      <BlockIcon type={props.type} />
      <BlockLabel type={props.type} />
    </BlockCardLayout>
  )

  switch (props.type) {
    case BubbleBlockType.EMBED:
      return renderBlockCardLayout(t('blocks.bubbles.embed.blockCard.tooltip'))
    case InputBlockType.FILE:
      return renderBlockCardLayout(
        t('blocks.inputs.fileUpload.blockCard.tooltip')
      )
    case LogicBlockType.SCRIPT:
      return renderBlockCardLayout(
        t('editor.blockCard.logicBlock.tooltip.code.label')
      )
    case LogicBlockType.TYPEBOT_LINK:
      return renderBlockCardLayout(
        t('editor.blockCard.logicBlock.tooltip.typebotLink.label')
      )
    case LogicBlockType.JUMP:
      return renderBlockCardLayout(
        t('editor.blockCard.logicBlock.tooltip.jump.label')
      )
    case IntegrationBlockType.GOOGLE_SHEETS:
      return renderBlockCardLayout(
        t('blocks.integrations.googleSheets.blockCard.tooltip')
      )
    case IntegrationBlockType.GOOGLE_ANALYTICS:
      return renderBlockCardLayout(
        t('blocks.integrations.googleAnalytics.blockCard.tooltip')
      )
    default:
      return (
        <BlockCardLayout {...props}>
          <BlockIcon type={props.type} />
          <BlockLabel type={props.type} />
        </BlockCardLayout>
      )
  }
}
