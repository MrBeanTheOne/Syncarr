(function () {
  const FILE_TYPES = [
    {
      key: 'image',
      label: 'Image',
      extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg', 'heic', 'heif', 'ico'],
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 16-5-5L5 19"/></svg>'
    },
    {
      key: 'video',
      label: 'Video',
      extensions: ['mp4', 'mov', 'mkv', 'avi', 'wmv', 'webm', 'm4v', 'mpg', 'mpeg'],
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 9 4-2v10l-4-2z"/><path d="M7 9h4M7 13h3"/></svg>'
    },
    {
      key: 'audio',
      label: 'Audio',
      extensions: ['mp3', 'wav', 'flac', 'aiff', 'aif', 'm4a', 'aac', 'ogg', 'wma'],
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>'
    },
    {
      key: 'pdf',
      label: 'PDF',
      extensions: ['pdf'],
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M7.5 16h2M7.5 12h5M7.5 14h7"/></svg>'
    },
    {
      key: 'document',
      label: 'Document',
      extensions: ['doc', 'docx', 'odt', 'rtf', 'pages'],
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>'
    },
    {
      key: 'spreadsheet',
      label: 'Spreadsheet',
      extensions: ['xls', 'xlsx', 'ods', 'csv', 'tsv'],
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M12 10v9"/></svg>'
    },
    {
      key: 'presentation',
      label: 'Presentation',
      extensions: ['ppt', 'pptx', 'odp', 'key'],
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H4z"/><path d="M12 16v4M9 20h6"/><path d="m8 12 3-3 2 2 3-4"/></svg>'
    },
    {
      key: 'archive',
      label: 'Archive',
      extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h6"/><path d="M9 5h2M9 8h2M10 11v6"/><rect x="8" y="15" width="4" height="3" rx="1"/></svg>'
    },
    {
      key: 'code',
      label: 'Code',
      extensions: ['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'scss', 'py', 'php', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'cs', 'sh', 'bat', 'ps1', 'sql', 'xml', 'yaml', 'yml'],
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m10 13-2 2 2 2M14 13l2 2-2 2"/></svg>'
    },
    {
      key: 'text',
      label: 'Text',
      extensions: ['txt', 'md', 'markdown', 'log', 'ini', 'cfg', 'conf', 'nfo'],
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 12h8M8 16h8"/></svg>'
    },
    {
      key: 'app',
      label: 'Application',
      extensions: ['exe', 'msi', 'app', 'dmg', 'pkg', 'deb', 'rpm'],
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9z"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>'
    }
  ];

  const GENERIC_FILE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  const FOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5h5.2l2 2H20a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2z"/><path d="M2 11h20"/></svg>';

  function extensionFromPath(filePath) {
    const leaf = String(filePath || '').split(/[\\/]/).pop() || '';
    if (!leaf.includes('.') || leaf.startsWith('.') && leaf.indexOf('.', 1) === -1) return '';
    return leaf.split('.').pop().toLowerCase();
  }

  function kindForPath(filePath) {
    const extension = extensionFromPath(filePath);
    const match = FILE_TYPES.find((type) => type.extensions.includes(extension));
    return match || { key: 'file', label: extension ? `${extension.toUpperCase()} file` : 'File', extensions: [], svg: GENERIC_FILE_SVG };
  }

  function wrapIcon(className, label, svg) {
    return `<span class="${className}" title="${label}" aria-hidden="true">${svg}</span>`;
  }

  function fileIconHtml(filePath) {
    const kind = kindForPath(filePath);
    return wrapIcon(`file-type-icon type-${kind.key}`, kind.label, kind.svg);
  }

  function folderIconHtml() {
    return wrapIcon('file-type-icon type-folder', 'Folder', FOLDER_SVG);
  }

  window.SyncarrFileBrowser = {
    fileIconHtml,
    folderIconHtml,
    fileKindLabel(filePath) {
      return kindForPath(filePath).label;
    }
  };
}());
