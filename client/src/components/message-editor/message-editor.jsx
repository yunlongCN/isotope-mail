import React, {Component} from 'react';
import {connect} from 'react-redux';
import {translate} from 'react-i18next';
import PropTypes from 'prop-types';
import {Editor} from '@tinymce/tinymce-react';
import HeaderAddress from './header-address';
import MceButton from './mce-button';
import {EDITOR_BUTTONS} from './editor-buttons';
import {editMessage} from '../../actions/application';
import {sendMessage} from '../../services/smtp';
import {persistApplicationNewMessageContent} from '../../services/indexed-db';
import mainCss from '../../styles/main.scss';
import styles from './message-editor.scss';

const EDITOR_PERSISTED_AFTER_CHARACTERS_ADDED = 50;

const EDITOR_CONFIG = {
  menubar: false,
  statusbar: false,
  toolbar: false,
  plugins: 'autoresize lists',
  content_style: 'body {padding:0}', // DOESN'T WORK
  browser_spellcheck: true,
  paste_data_images: true,
  entity_encoding: 'named', // Converts characters to html entities ' ' > &nbsp;
  formats: {
    isotope_code: {
      block: 'pre', classes: ['code']
    }
  }
};

class MessageEditor extends Component {
  constructor(props) {
    super(props);
    this.state = {
      editorState: {}
    };

    this.editorRef = React.createRef();
    this.handleSubmit = this.submit.bind(this);
    // Header Address Events
    this.handleOnHeaderKeyPress = this.onHeaderKeyPress.bind(this);
    this.handleOnHeaderBlur = this.onHeaderBlur.bind(this);
    this.handleOnHeaderAddressRemove = this.onHeaderAddressRemove.bind(this);
    // Subject events
    this.handleOnSubjectChange = this.onSubjectChange.bind(this);
    // Editor events
    this.handleEditorChange = this.editorChange.bind(this);
    this.handleEditorBlur = this.editorBlur.bind(this);
    this.handleSelectionChange = this.selectionChange.bind(this);
  }

  render() {
    const {t, className, close, application, to, cc, bcc, subject, content} = this.props;
    return (
      <div className={`${className} ${styles['message-editor']}`}>
        <div className={styles.header}>
          <HeaderAddress id={'to'} addresses={to} onKeyPress={this.handleOnHeaderKeyPress}
            onBlur={this.handleOnHeaderBlur} onAddressRemove={this.handleOnHeaderAddressRemove}
            className={styles.address} chipClassName={styles.chip} label={t('messageEditor.to')} />
          <HeaderAddress id={'cc'} addresses={cc} onKeyPress={this.handleOnHeaderKeyPress}
            onBlur={this.handleOnHeaderBlur} onAddressRemove={this.handleOnHeaderAddressRemove}
            className={styles.address} chipClassName={styles.chip} label={t('messageEditor.cc')} />
          <HeaderAddress id={'bcc'} addresses={bcc} onKeyPress={this.handleOnHeaderKeyPress}
            onBlur={this.handleOnHeaderBlur} onAddressRemove={this.handleOnHeaderAddressRemove}
            className={styles.address} chipClassName={styles.chip} label={t('messageEditor.bcc')} />
          <div className={styles.subject}>
            <input type={'text'} placeholder={'Subject'}
              value={subject} onChange={this.handleOnSubjectChange} />
          </div>
        </div>
        <div className={styles['editor-wrapper']} onClick={() => this.editorWrapperClick()}>
          <div className={styles['editor-container']}>
            <Editor
              ref={this.editorRef}
              initialValue={content}
              onEditorChange={this.handleEditorChange}
              onSelectionChange={this.handleSelectionChange}
              // Force initial content (reply messages) to be persisted in IndexedDB with base64/datauri embedded images
              onInit={() => this.getEditor().uploadImages().then(() => this.getEditor().fire('Change'))}
              onBlur={this.handleEditorBlur}
              onPaste={event => this.editorPaste(event)}
              inline={true}
              init={EDITOR_CONFIG}
            />
          </div>
          {this.renderEditorButtons()}
        </div>
        <div className={styles['action-buttons']}>
          <button
            className={`${mainCss['mdc-button']} ${mainCss['mdc-button--unelevated']}
            ${styles['action-button']} ${styles.send}`}
            disabled={to.length + cc.length + bcc.length === 0} onClick={this.handleSubmit}>
            Send
          </button>
          <button className={`material-icons ${mainCss['mdc-icon-button']} ${styles['action-button']} ${styles.cancel}`}
            onClick={() => close(application)}>
            delete
          </button>
        </div>
      </div>
    );
  }

  renderEditorButtons() {
    return <div className={`${mainCss['mdc-card']} ${styles['button-container']}`}>
      {Object.entries(EDITOR_BUTTONS).map(([k, b]) => (
        <MceButton
          key={k}
          className={styles.button}
          activeClassName={styles.active}
          active={this.state.editorState && this.state.editorState[k] === true}
          label={b.label}
          icon={b.icon}
          onToggle={() => b.toggleFunction(this.getEditor(), b)}
        />))}
    </div>;
  }

  submit() {
    // Get content directly from editor, state content may not contain latest changes
    const content = this.getEditor().getContent();
    const {credentials, to, cc, bcc, subject} = this.props;
    this.props.sendMessage(credentials, {...this.props.editedMessage, to, cc, bcc, subject, content});
    this.props.close(this.props.application);
  }

  onHeaderAddressRemove(id, index) {
    const updatedMessage = {...this.props.editedMessage};
    updatedMessage[id] = [...updatedMessage[id]];
    updatedMessage[id].splice(index, 1);
    this.props.editMessage(updatedMessage);
  }

  onHeaderKeyPress(event) {
    const target = event.target;
    if (event.key === 'Enter' || event.key === ';') {
      if (target.validity.valid) {
        this.addAddress(target);
        target.focus();
        event.preventDefault();
      } else {
        target.reportValidity();
      }
    }
  }

  onHeaderBlur(event) {
    const target = event.target;
    if (target.value.length > 0) {
      if (target.validity.valid) {
        this.addAddress(target);
      } else {
        event.preventDefault();
        setTimeout(() => target.reportValidity());
      }
    }
  }

  onSubjectChange(event) {
    const target = event.target;
    const updatedMessage = {...this.props.editedMessage};
    this.props.editMessage({...updatedMessage, subject: target.value});
  }
  /**
   * Adds an address to the list matching the id and value in the provided event target.
   *
   * @param target {object}
   */
  addAddress(target) {
    const value = target.value.replace(/;/g, '');
    if (value.length > 0) {
      const updatedMessage = {...this.props.editedMessage};
      updatedMessage[target.id] = [...updatedMessage[target.id], target.value.replace(/;/g, '')];
      this.props.editMessage(updatedMessage);
      target.value = '';
    }
  }

  getEditor() {
    if (this.editorRef.current && this.editorRef.current.editor) {
      return this.editorRef.current.editor;
    }
    return null;
  }

  editorWrapperClick() {
    this.getEditor().focus();
  }

  /**
   * Every change in the editor will trigger this method.
   *
   * For performance reasons, we'll only persist the editor content every EDITOR_PERSISTED_AFTER_CHARACTERS_ADDED
   *
   * @param content
   */
  editorChange(content) {
    // Commit changes every 50 keystrokes
    if (Math.abs(this.props.content.length - content.length) > EDITOR_PERSISTED_AFTER_CHARACTERS_ADDED) {
      this.props.editMessage({...this.props.editedMessage, content});
      // noinspection JSIgnoredPromiseFromCall
      persistApplicationNewMessageContent(this.props.application, content);
    }
  }

  /**
   * Persist whatever is in the editor as changes are only persisted every EDITOR_PERSISTED_AFTER_CHARACTERS_ADDED
   */
  editorBlur() {
    const content = this.getEditor().getContent();
    this.props.editMessage({...this.props.editedMessage, content});
    // noinspection JSIgnoredPromiseFromCall
    persistApplicationNewMessageContent(this.props.application, content);
  }

  editorPaste(pasteEvent) {
    if (pasteEvent.clipboardData) {
      const editor = this.getEditor();
      const items = pasteEvent.clipboardData.items;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image/') === 0) {
          pasteEvent.preventDefault();
          // Although item.getAsFile() is effectively a Blob, in some Linux Desktop environments, mime type of the
          // File/Blob is lost when creating the object URL. This workaround prevents mime type from being lost
          // Data is Pasted as File(Blob), it's read with FileReader again, and reconverted to Blob to create ObjectUrl
          const blobReader = new FileReader();
          const type = item.type;
          blobReader.onload = e => {
            const objectUrl = URL.createObjectURL(new Blob([e.target.result], {type}));
            editor.execCommand('mceInsertContent', false, `<img alt="" src="${objectUrl}"/>`);
          };
          blobReader.readAsArrayBuffer(item.getAsFile());
        }
      }
    }
  }

  selectionChange() {
    const editorState = {};
    const editor = this.getEditor();
    if (!editor || !editor.selection) {
      return;
    }
    const node = editor.selection.getNode();
    Object.entries(EDITOR_BUTTONS).forEach(([k, button]) => {
      editorState[k] = button.activeFunction({editor, key: k, button, node});
    });
    // Trigger state change only if values of the selection have changed
    for (const [k, v] of Object.entries(editorState)) {
      if (v !== this.state.editorState[k]) {
        this.setState({editorState});
        break;
      }
    }
  }
}

MessageEditor.propTypes = {
  className: PropTypes.string,
  t: PropTypes.func.isRequired
};

MessageEditor.defaultProps = {
  className: ''
};

const mapStateToProps = state => ({
  application: state.application,
  credentials: state.application.user.credentials,
  editedMessage: state.application.newMessage,
  to: state.application.newMessage.to,
  cc: state.application.newMessage.cc,
  bcc: state.application.newMessage.bcc,
  subject: state.application.newMessage.subject,
  editor: state.application.newMessage.editor,
  content: state.application.newMessage.content
});

const mapDispatchToProps = dispatch => ({
  close: application => {
    dispatch(editMessage(null));
    // Clear content (editorBlur may be half way through -> force a message in the service worker to clear content after)
    // noinspection JSIgnoredPromiseFromCall
    persistApplicationNewMessageContent(application, '');
  },
  editMessage: message => {
    dispatch(editMessage(message));
  },
  sendMessage: (credentials, {inReplyTo = [], references = [], to, cc, bcc, subject, content}) =>
    sendMessage(dispatch, credentials, {inReplyTo, references, to, cc, bcc, subject, content})
});

export default connect(mapStateToProps, mapDispatchToProps)(translate()(MessageEditor));
