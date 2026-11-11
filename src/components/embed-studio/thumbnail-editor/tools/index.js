import { Icon } from '../../../v2/Icon';
import FrameTool from './FrameTool';
import TextTool from './TextTool';
import PickFrameTool from './PickFrameTool';
import StickerTool from './StickerTool';

// The tabs under the thumbnail preview, in order. A tool is a panel component
// that gets the props ThumbnailTools passes through ({ edit, onChange,
// selectedId, onSelect, image, width, height, videoFile, onPickFrame,
// onToolChange }) and changes the thumbnail only through those callbacks.
//
//   layerType   the layers it owns: picking one on the preview opens this tool
//   needsImage  false when it works without a chosen picture (default: true)
//   available   (props) => false hides the tab, e.g. without a video file
export const THUMBNAIL_TOOLS = [
  { key: 'frame', icon: Icon.of('crop'), labelKey: 'upload.thumbnail.tools.frame', Panel: FrameTool },
  { key: 'text', icon: Icon.of('title'), labelKey: 'upload.thumbnail.tools.text', Panel: TextTool, layerType: 'text' },
  { key: 'stickers', icon: Icon.of('mood'), labelKey: 'upload.thumbnail.tools.stickers', Panel: StickerTool, layerType: 'sticker' },
  {
    key: 'pickFrame',
    icon: Icon.of('photo_library'),
    labelKey: 'upload.thumbnail.tools.pickFrame',
    Panel: PickFrameTool,
    needsImage: false,
    available: ({ videoFile }) => !!videoFile,
  },
];

export const toolIsEnabled = (tool, props) => tool.needsImage === false || !!props.image;
