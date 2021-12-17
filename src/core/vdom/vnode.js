/* @flow */

export default class VNode {   //总共25个key属性
  tag: string | void; // 标签
  data: VNodeData | void; // 节点数据
  children: ?Array<VNode>; // 子节点
  text: string | void; // 文本
  elm: Node | void; // 当前虚拟节点对应的真实dom节点
  ns: string | void; // 名字空间
  context: Component | void; // rendered in this component's scope 在该组件的作用域中呈现
  key: string | number | void; // key 值
  componentOptions: VNodeComponentOptions | void; // 组件选项
  componentInstance: Component | void; // component instance 组件实例
  parent: VNode | void; // component placeholder node 组件占位符节点  当前节点的父节点

  // strictly internal 严格内部的
  raw: boolean; // contains raw HTML? (server only) 包含原始HTML?(仅限服务器) 简而言之就是是否为原生HTML或只是普通文本，innerHTML的时候为true，textContent的时候为false
  isStatic: boolean; // hoisted static node 悬挂静力节点  静态节点标志
  isRootInsert: boolean; // necessary for enter transition check 是否需要输入转化检查  是否作为根节点插入
  isComment: boolean; // empty comment placeholder? 空注释占位符？   是否为注释节点
  isCloned: boolean; // is a cloned node?  是克隆节点吗？  是否是克隆节点
  isOnce: boolean; // is a v-once node? 是v-once节点吗？  是否有v-once指令
  asyncFactory: Function | void; // async component factory function 异步组件工厂函数
  asyncMeta: Object | void; // 异步meta
  isAsyncPlaceholder: boolean; // 是否是异步占位符
  ssrContext: Object | void; //服务器渲染上下文
  fnContext: Component | void; // real context vm for functional nodes 功能节点上的实上下文虚拟机  函数式组件对应的Vue实例
  fnOptions: ?ComponentOptions; // for SSR caching  用于SSR缓存
  devtoolsMeta: ?Object; // used to store functional render context for devtools 用于存储devtools的功能渲染上下文
  fnScopeId: ?string; // functional scope id support 功能范围id支持

  constructor (
    tag?: string,
    data?: VNodeData,
    children?: ?Array<VNode>,
    text?: string,
    elm?: Node,
    context?: Component,
    componentOptions?: VNodeComponentOptions,
    asyncFactory?: Function
  ) {
    this.tag = tag
    this.data = data
    this.children = children
    this.text = text
    this.elm = elm
    this.ns = undefined
    this.context = context
    this.fnContext = undefined
    this.fnOptions = undefined
    this.fnScopeId = undefined
    this.key = data && data.key
    this.componentOptions = componentOptions
    this.componentInstance = undefined
    this.parent = undefined
    this.raw = false
    this.isStatic = false
    this.isRootInsert = true
    this.isComment = false
    this.isCloned = false
    this.isOnce = false
    this.asyncFactory = asyncFactory
    this.asyncMeta = undefined
    this.isAsyncPlaceholder = false
    // ssrContext  devtoolsMeta 这两个没包含在以上的初始赋值中
  }

  // DEPRECATED: alias for componentInstance for backwards compat. 不推荐使用：向后兼容的componentInstance的别名
  /* istanbul ignore next  伊斯坦布尔 忽略下一个*/
  get child (): Component | void {
    return this.componentInstance
  }
}

/**
 * 通过属性之间的不同搭配，VNode类可以描述出各种类型的真实DOM节点。可以描述以下几种类型的节点：
 * 注释节点 / 文本节点 / 元素节点 / 组件节点 / 函数式组件节点 / 克隆节点
 */

// 创建注释节点
export const createEmptyVNode = (text: string = '') => {
  const node = new VNode()
  node.text = text // text表示具体的注释信息
  node.isComment = true // 标志 用来标识一个节点是否是注释节点
  return node
}

// 创建文本节点 文本节点描述起来比注释节点更简单，因为它只需要一个属性，那就是text属性，用来表示具体的文本信息
export function createTextVNode (val: string | number) {
  return new VNode(undefined, undefined, undefined, String(val))
}

// optimized shallow clone
// used for static nodes and slot nodes because they may be reused across  用于静态节点和插槽节点的优化浅层克隆，因为它们可以在多个渲染中重用，
// multiple renders, cloning them avoids errors when DOM manipulations rely  所以当DOM操作依赖于它们的elm引用时，克隆它们可以避免错误。
// on their elm reference.
// 克隆节点就是把一个已经存在的节点复制一份出来，它主要是为了做模板编译优化时使用
// 克隆节点就是把已有节点的属性全部复制到新节点中，而现有节点和新克隆得到的节点之间唯一不同就是克隆得到的节点isCloned为true
export function cloneVNode (vnode: VNode): VNode {
  const cloned = new VNode(
    vnode.tag,
    vnode.data,
    // #7975
    // clone children array to avoid mutating original in case of cloning 克隆子阵列以避免在克隆子阵列时对原始阵列进行变异
    // a child.
    vnode.children && vnode.children.slice(),
    vnode.text,
    vnode.elm,
    vnode.context,
    vnode.componentOptions,
    vnode.asyncFactory
  )
  cloned.ns = vnode.ns
  cloned.isStatic = vnode.isStatic
  cloned.key = vnode.key
  cloned.isComment = vnode.isComment
  cloned.fnContext = vnode.fnContext
  cloned.fnOptions = vnode.fnOptions
  cloned.fnScopeId = vnode.fnScopeId
  cloned.asyncMeta = vnode.asyncMeta
  cloned.isCloned = true
  return cloned
}


/**
 *
    let div = document.createElement('div')
    let str = ''
    for (const key in div) {
        str += key + ' / '
    }
    console.log(str)

    align / title / lang / translate / dir / hidden / accessKey / draggable / spellcheck / autocapitalize / contentEditable / isContentEditable / inputMode / offsetParent / offsetTop / offsetLeft / offsetWidth / offsetHeight / style / innerText / outerText / onbeforexrselect / onabort / onblur / oncancel / oncanplay / oncanplaythrough / onchange / onclick / onclose / oncontextmenu / oncuechange / ondblclick / ondrag / ondragend / ondragenter / ondragleave / ondragover / ondragstart / ondrop / ondurationchange / onemptied / onended / onerror / onfocus / onformdata / oninput / oninvalid / onkeydown / onkeypress / onkeyup / onload / onloadeddata / onloadedmetadata / onloadstart / onmousedown / onmouseenter / onmouseleave / onmousemove / onmouseout / onmouseover / onmouseup / onmousewheel / onpause / onplay / onplaying / onprogress / onratechange / onreset / onresize / onscroll / onseeked / onseeking / onselect / onstalled / onsubmit / onsuspend / ontimeupdate / ontoggle / onvolumechange / onwaiting / onwebkitanimationend / onwebkitanimationiteration / onwebkitanimationstart / onwebkittransitionend / onwheel / onauxclick / ongotpointercapture / onlostpointercapture / onpointerdown / onpointermove / onpointerup / onpointercancel / onpointerover / onpointerout / onpointerenter / onpointerleave / onselectstart / onselectionchange / onanimationend / onanimationiteration / onanimationstart / ontransitionrun / ontransitionstart / ontransitionend / ontransitioncancel / oncopy / oncut / onpaste / dataset / nonce / autofocus / tabIndex / attachInternals / blur / click / focus / enterKeyHint / virtualKeyboardPolicy / onpointerrawupdate / namespaceURI / prefix / localName / tagName / id / className / classList / slot / attributes / shadowRoot / part / assignedSlot / innerHTML / outerHTML / scrollTop / scrollLeft / scrollWidth / scrollHeight / clientTop / clientLeft / clientWidth / clientHeight / attributeStyleMap / onbeforecopy / onbeforecut / onbeforepaste / onsearch / elementTiming / onfullscreenchange / onfullscreenerror / onwebkitfullscreenchange / onwebkitfullscreenerror / children / firstElementChild / lastElementChild / childElementCount / previousElementSibling / nextElementSibling / after / animate / append / attachShadow / before / closest / computedStyleMap / getAttribute / getAttributeNS / getAttributeNames / getAttributeNode / getAttributeNodeNS / getBoundingClientRect / getClientRects / getElementsByClassName / getElementsByTagName / getElementsByTagNameNS / getInnerHTML / hasAttribute / hasAttributeNS / hasAttributes / hasPointerCapture / insertAdjacentElement / insertAdjacentHTML / insertAdjacentText / matches / prepend / querySelector / querySelectorAll / releasePointerCapture / remove / removeAttribute / removeAttributeNS / removeAttributeNode / replaceChildren / replaceWith / requestFullscreen / requestPointerLock / scroll / scrollBy / scrollIntoView / scrollIntoViewIfNeeded / scrollTo / setAttribute / setAttributeNS / setAttributeNode / setAttributeNodeNS / setPointerCapture / toggleAttribute / webkitMatchesSelector / webkitRequestFullScreen / webkitRequestFullscreen / ariaAtomic / ariaAutoComplete / ariaBusy / ariaChecked / ariaColCount / ariaColIndex / ariaColSpan / ariaCurrent / ariaDescription / ariaDisabled / ariaExpanded / ariaHasPopup / ariaHidden / ariaKeyShortcuts / ariaLabel / ariaLevel / ariaLive / ariaModal / ariaMultiLine / ariaMultiSelectable / ariaOrientation / ariaPlaceholder / ariaPosInSet / ariaPressed / ariaReadOnly / ariaRelevant / ariaRequired / ariaRoleDescription / ariaRowCount / ariaRowIndex / ariaRowSpan / ariaSelected / ariaSetSize / ariaSort / ariaValueMax / ariaValueMin / ariaValueNow / ariaValueText / getAnimations / nodeType / nodeName / baseURI / isConnected / ownerDocument / parentNode / parentElement / childNodes / firstChild / lastChild / previousSibling / nextSibling / nodeValue / textContent / ELEMENT_NODE / ATTRIBUTE_NODE / TEXT_NODE / CDATA_SECTION_NODE / ENTITY_REFERENCE_NODE / ENTITY_NODE / PROCESSING_INSTRUCTION_NODE / COMMENT_NODE / DOCUMENT_NODE / DOCUMENT_TYPE_NODE / DOCUMENT_FRAGMENT_NODE / NOTATION_NODE / DOCUMENT_POSITION_DISCONNECTED / DOCUMENT_POSITION_PRECEDING / DOCUMENT_POSITION_FOLLOWING / DOCUMENT_POSITION_CONTAINS / DOCUMENT_POSITION_CONTAINED_BY / DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC / appendChild / cloneNode / compareDocumentPosition / contains / getRootNode / hasChildNodes / insertBefore / isDefaultNamespace / isEqualNode / isSameNode / lookupNamespaceURI / lookupPrefix / normalize / removeChild / replaceChild / addEventListener / dispatchEvent / removeEventListener /
 */


/**
 * 元素节点：
 *    更贴近于我们通常看到的真实DOM节点，它有描述节点标签名词的tag属性，描述节点属性如class、attributes等的data属性，有描述包含的子节点信息的children属性等。
 *    由于元素节点所包含的情况相比而言比较复杂，源码中没有像前三种节点一样直接写死（当然也不可能写死）举例简单说明一下，如下：
 *    // 真实DOM节点
 *    <div id='a'><span>难凉热血</span></div>
 *    // VNode节点
 *    {tag:'div', data:{}, children:[{tag:'span', text:'难凉热血'}]}
 * 组件节点：
 *    组件节点除了有元素节点具有的属性之外，它还有两个特有的属性：
 *    fnContext: 函数式组件对应的Vue实例
 *    fnOptions: 组件的option选项
 *
 *
 * 以上就是VNode可以描述的多种节点类型，它们本质上都是VNode类的实例，只是在实例化的时候传入的属性参数不同而已
 *
 * VNode的作用:
 *    VNode的作用是相当大的。我们在视图渲染之前，把写好的template模板先编译成VNode并缓存下来，等到数据发生变化页面需要重新渲染的时候，
 *    我们把数据发生变化后生成的VNode与前一次缓存下来的VNode进行对比，找出差异，然后有差异的VNode对应真实DOM节点就是需要重新渲染的节点，
 *    最后根据有差异的VNode创建出真实的DOM节点再插入到视图中，最终完成一次视图更新。
 *    最后探究了VNode的作用，有了数据变化前后的VNode，我们才能进行后续的DOM-Diff找出差异，最终做到只更新有差异的师徒，从而达到尽可能少的操作真是DOM的目的，以节省性能。
 *
 */
