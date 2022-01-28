/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson (MPL-1.1 OR Apache-2.0 OR GPL-2.0-or-later)
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */

import { makeMap, no } from 'shared/util'
import { isNonPhrasingTag } from 'web/compiler/util'
import { unicodeRegExp } from 'core/util/lang'

// Regular Expressions for parsing tags and attributes
const attribute = /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
const dynamicArgAttribute = /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+?\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
const ncname = `[a-zA-Z_][\\-\\.0-9_a-zA-Z${unicodeRegExp.source}]*`
const qnameCapture = `((?:${ncname}\\:)?${ncname})`
const startTagOpen = new RegExp(`^<${qnameCapture}`)
const startTagClose = /^\s*(\/?)>/
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`)
const doctype = /^<!DOCTYPE [^>]+>/i
// #7298: escape - to avoid being passed as HTML comment when inlined in page
const comment = /^<!\--/
const conditionalComment = /^<!\[/

// Special Elements (can contain anything)
export const isPlainTextElement = makeMap('script,style,textarea', true)
const reCache = {}

const decodingMap = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
  '&#10;': '\n',
  '&#9;': '\t',
  '&#39;': "'"
}
const encodedAttr = /&(?:lt|gt|quot|amp|#39);/g
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#39|#10|#9);/g

// #5992
const isIgnoreNewlineTag = makeMap('pre,textarea', true)
const shouldIgnoreFirstNewline = (tag, html) => tag && isIgnoreNewlineTag(tag) && html[0] === '\n'

function decodeAttr (value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr
  return value.replace(re, match => decodingMap[match])
}

/**
  * HTML解析器
  * 主要负责解析出模板字符串中有哪些内容，然后根据不同的内容才能调用其他解析器以及做相应的处理。
  * HTML解析器就是parseHTML函数，在模板解析主线程函数parse中调用了该函数，并传入两个参数： template 待转换的模板字符串  options 转换时所需的选项
  * 还定义了四个钩子函数： start end chars comment 它们就是用来当字符串中不同的内容出来之后，钩子函数把提取出来的内容生成对应的AST
  * 一边解析不同的内容一遍调用对应的钩子函数生成对应的AST节点，最终完成将整个模板字符串转化成AST,这就是HTML解析器所要做的工作。
  *
  *   如何解析不同的内容？
  * 要从模板字符串中解析出不同的内容，首先要知道的是模板字符串中都会包含哪些内容。通常包括如下的内容：
  * ·文本，例如“难凉热血”
  * ·HTML注释，例如<!-- 我是注释 -->
  * ·条件注释，例如<!-- [if !IE]>-->我是注释<!--<！[endif] -->
  * ·DOCTYPE,例如<!DOCTYPE html>
  * ·开始标签，例如<div>
  * ·结束标签，例如</div>
  * 这几种内容都有其各自独有的特点，也就是说我们要根据不同内容所具有的不同的特点通过编写不同的正则表达式将这些内容从模板字符串中一一解析出来，然后再把不同的内容解析出来。
  *
  * 1.解析HTML注释
  * 解析注释比较简单，HTML注释以<!-- 开头，以 -->结尾，这两者中间的内容就是注释内容，那么我们只需用正则判断待解析的模板字符串html是否以<!--开头，若是，那就继续向后寻找-->,
  * 如果找到了，ok,注释就被解析出来了。 选项中的comments选项的true还是false来决定在渲染模板时是否保留注释，即 options.shouldKeepComment为ture还是false
  *
  * index
  *   |
  *   |
  *  \ /
  *   <div class="a">我是模板</div>
  *
  * *    index
  *      |
  *      |
  *     \ /
  *   <div class="a">我是模板</div>
  * 从图中可以看到，解析游标index最开始在模板字符串的位置0处，当调用了advance(3)之后，解析游标到了位置3处，每次解析完一段内容就将游标向后移动一段，接着再从解析游标往后解析，
  * 这样就保证了解析过的内容不会被重复解析
  *
  * 2.解析条件注释
  * 解析条件注释也比较简单，其原理跟注释相同，都是先用正则判断是否是以条件注释特有的开头标识符开始，然后寻找其特有的结束标识符，若找到，则说明是条件注释，将其截取出来即可，
  * 由于条件注释不存在于真正的DOM中，所以不需要调用钩子函数创建AST节点。
  *
  * 3.解析DOCTYPE
  * 解析DOCTYPE的原理同解析条件注释完全相同，此处不再赘述
  *
  * 4.解析开始标签
  * 相较于前三种内容的解析，解析开始标签会稍微复杂一点，但是万变不离其宗，它的原理还是相痛的，都是使用正则去匹配提取。
  * 首先使用开始标签的正则匹配模板字符串，看模板字符串中是否具有开始标签的特征。前文中说到，当解析到开始标签时，会调用4个钩子函数中的start函数，start函数接收三个参数，分别是标签名tag、标签属性attrs、标签书否自闭合unary.
  * 标签名通过正则匹配的结果，即上面代码中的start[1],而标签属性attrs以及标签是否闭合unary需要进一步解析。1.解析标签属性 2.解析标签是否自闭合
  * 调用parseStartTag函数，如果模板字符串符合开始标签的特征，则解析开始标签，并将解析结果返回，如果不符合开始标签的特征，则返回undefined。解析完毕后，就可以用解析得到的结果去调用start钩子函数去创建元素型的AST节点了。
  * 在源码中，Vue并没有直接去调start钩子函数去创建AST节点，而是调用了handleStartTag函数，在该函数内部才去调的start钩子函数，为什么要这样做呢？这是因为虽然经过parseStartTag函数已经把创建AST节点必要信息提取出来了，
  * 但是提取出来的标签属性数组还是需要处理一下，下面我们就来看一下handleStartTag函数都做了些什么事。handleStartTag函数用来对parseStartTag函数的解析结果进行进一步处理，它接收parseStartTag函数的返回值作为参数。
  * handleStartTag函数的开始定义几个常量：
  *  tagName = match.tagName       // 开始标签的标签名
  *  unarySlash = match.unarySlash  // 是否为自闭合标签的标志，自闭合为"",非自闭合为"/"
  *  unary = isUnaryTag(tagName) || !!unarySlash  // 布尔值，标志是否为自闭合标签
  *  l = match.attrs.length    // match.attrs 数组的长度
  *  attrs = new Array(l)  // 一个与match.attrs数组长度相等的数组
  * 接着定义了shouldDecodeNewlines，这个常量主要是做一些兼容性处理， 如果 shouldDecodeNewlines 为 true，意味着 Vue 在编译模板的时候，要对属性值中的换行符或制表符做兼容处理。而shouldDecodeNewlinesForHref为true 意味着Vue在编译模板的时候，要对a标签的 href属性值中的换行符或制表符做兼容处理。
  *
  * 5.解析结束标签
  * 结束标签的解析要比解析开始标签容易多了，因为它不需要解析什么属性，只需要判断剩下的模板字符串是否符合结束标签的特征，如果是，就将结束标签名提取出来，再调用4个钩子函数中的end函数就好了。
  * 在上面代码中，没有直接去调用end函数，而是调用了parseEndTag函数，关于parseEndTag函数内部的作用我们后面会介绍到，在这里你暂时可以理解为该函数内部就是去调用了end钩子函数。
  *
  * 6.解析文本
  * 解析文本也比较容易，在解析字符串之前，我们先查找一下第一个<出现在什么位置：如果出现在第一个位置，那么说明模板字符串是以文本开头的；如果不在第一个位置而在模板字符串中间某个位置，说明模板字符串以文本开头的，
  * 那么开头到第一个<出现到位置就是文本内容了；如果在整个模板字符串都没有找到<,那说明整个模板字符串都是文本。这就是解析思路
  *
  * 如何保证AST节点层级关系
  * Vue在HTML解析器的开头定义了一个栈stack,这个栈就是用来维护ADST的层级的。HTML解析器在从前向后解析模板字符串时，每当遇到开始标签时就会调用start钩子函数，
  * 那么在start钩子函数内部我们可以将解析得到的开始标签推入栈中，而每当遇到结束标签时就会调用end钩子函数，那么我们也可以在end钩子函数内部将解析得到的结束标签所对应的开始标签从栈中弹出。
  * 请看如下的例子：
  * 加入有如下模板字符串： <div><p><span></span></p></div>
  * 解析到开始标签<div>时，就把div推入栈中，然后继续解析，当解析到<p>时，再把p推入栈中，同理，再把span推入栈中，当解析到结束标签</span>时，此时栈顶的标签刚好是span的开始标签，
  * 那么就用span的开始标签和结束标签构建AST节点，并且从栈中把span的开始标签弹出，那么此时栈中的栈顶标签p就是构建好的span的AST节点的父节点，如下图：
  *                  </span>
  *                      \
  *                       |  匹配后弹出
  *                      |
  *         ｜--- <span>/
  *         ｜
  * stack栈-----  <p>   <---------  当前匹配节点的父节点
  *         |
  *         |---  <div>
  *
  * 这样我们就找到了当前被构建节点的父节点。这只是栈的一个用途，它还有另外一个用途，我们再看如下模板字符串：
  * <div><p><span></p></div>
  * 按照上面的流程解析这个模板字符串时，当解析到结束标签</p>时，此时栈顶的标签应该是p才对，而现在是span，那么就说明span标签没有被正确闭合，
  * 此时控制台就会抛出警告：‘tag has no matching end tag.’相信这个警告你一定不会陌生。这就是栈的第二个用途： 检测模板字符串中是否有未正确闭合的标签。
*/
export function parseHTML (html, options) {
  const stack = [] // 维护AST节点层级的栈
  const expectHTML = options.expectHTML
  const isUnaryTag = options.isUnaryTag || no
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no //用来检测一个标签是否是可以省略闭合标签的非自闭和标签
  let index = 0 // 解析游标，标识当前从何处开始解析模板字符串
  let last, lastTag //存储剩余还未解析的模板字符串 存储着位于stack栈顶的元素
  // 开启一个while循环，循环结束的条件时html为空，即html被parse完毕
  while (html) { // 循环的终止条件是模板字符串html为空，即模板字符串被全部编译完毕。
    last = html // 在每次while循环中，先把html的值赋值给变量last 这样做的目的是：如果经过上述所有逻辑处理后，html字符串没有任何变化，
    // 即表示html字符串没有匹配上任何一条规则，那么就把html字符串当作纯文本对待，创建文本类型的AST节点并且如果抛出异常：模板字符串中标签格式有误 见277-283行
    // Make sure we're not in a plaintext content element like script/style 确保即将parse的内容不是在纯文本标签里(script,style,textarea ，因为在这三个标签里面肯定不会有HTML标签，所以我们可直接当作文本处理)
    if (!lastTag || !isPlainTextElement(lastTag)) {
      /**
       * 如果html字符串时以'<'开头，则有一下几种可能
       * 开始标签：<div>
       * 结束标签：</div>
       * 注释：<!-- 我是注释 -->
       * 条件注释：<!-- [if !IE] --> <!-- [endif] -->
       * DOCTYPE: <!DOCTYPE html>
       * 需要一一去匹配尝试
       */
      let textEnd = html.indexOf('<')
      if (textEnd === 0) {
        // Comment:
        // 解析是否时注释
        if (comment.test(html)) {
          const commentEnd = html.indexOf('-->')

          if (commentEnd >= 0) {
            if (options.shouldKeepComment) {
              options.comment(html.substring(4, commentEnd), index, index + commentEnd + 3)
            }
            advance(commentEnd + 3)
            continue
          }
        }

        // http://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        // 解析是否是条件注释
        if (conditionalComment.test(html)) {
          const conditionalEnd = html.indexOf(']>')

          if (conditionalEnd >= 0) {
            advance(conditionalEnd + 2)
            continue
          }
        }

        // Doctype:
        // 解析是否是DOCTYPE
        const doctypeMatch = html.match(doctype)
        if (doctypeMatch) {
          advance(doctypeMatch[0].length)
          continue
        }

        // End tag:
        // 解析是否是结束标签
        const endTagMatch = html.match(endTag)
        if (endTagMatch) {
          const curIndex = index
          advance(endTagMatch[0].length)
          parseEndTag(endTagMatch[1], curIndex, index)
          continue
        }

        // Start tag:
        // 匹配是否是开始标签
        const startTagMatch = parseStartTag()
        if (startTagMatch) {
          handleStartTag(startTagMatch)
          if (shouldIgnoreFirstNewline(startTagMatch.tagName, html)) {
            advance(1)
          }
          continue
        }
      }

      // 如果字符串不是以'<'开头，则解析文本类型
      let text, rest, next
      if (textEnd >= 0) {
        rest = html.slice(textEnd)
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          next = rest.indexOf('<', 1)
          if (next < 0) break
          textEnd += next
          rest = html.slice(textEnd)
        }
        text = html.substring(0, textEnd)
      }

      // 如果在html字符串中没有找到'<',表示这一段html都是纯文本
      if (textEnd < 0) {
        text = html
      }

      if (text) {
        advance(text.length)
      }

      // 把截取出来的text转换成testAST
      if (options.chars && text) {
        options.chars(text, index - text.length, index)
      }
    } else { // 父元素为script、style、textarea时，其内部的内容全部当作纯文本处理
      let endTagLength = 0
      const stackedTag = lastTag.toLowerCase()
      const reStackedTag = reCache[stackedTag] || (reCache[stackedTag] = new RegExp('([\\s\\S]*?)(</' + stackedTag + '[^>]*>)', 'i'))
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        endTagLength = endTag.length
        if (!isPlainTextElement(stackedTag) && stackedTag !== 'noscript') {
          text = text
            .replace(/<!\--([\s\S]*?)-->/g, '$1') // #7298
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
        }
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          text = text.slice(1)
        }
        if (options.chars) {
          options.chars(text)
        }
        return ''
      })
      index += html.length - rest.length
      html = rest
      parseEndTag(stackedTag, index - endTagLength, index)
    }

    // 将整个字符串作为文本对待
    if (html === last) {
      options.chars && options.chars(html)
      if (process.env.NODE_ENV !== 'production' && !stack.length && options.warn) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`, { start: index + html.length })
      }
      break
    }
  }

  // Clean up any remaining tags
  parseEndTag()
  /**
   * 这行代码执行的时机是html===last,即html字符串中的标签格式有误时会跳出while循环，此时就会执行这行代码，这行代码是调用parseEndTag函数并不传递任何参数，
   * 前面说过如果parseEndTag如果不传递任何参数是用于处理栈中剩余未处理的标签。这是因为如果不传递任何函数，此时parseEndTag函数里的pos就为0，
   * 那么pos>=0就会恒成立，那么就会逐个警告缺少闭合标签，并调用options.end将其闭合。
   */

  function advance (n) {
    index += n
    html = html.substring(n)
  }

  // parse 开始标签
  function parseStartTag () {
    const start = html.match(startTagOpen)
    if (start) {
      const match = {
        tagName: start[1],
        attrs: [],
        start: index
      }
      advance(start[0].length)
      let end, attr
      while (!(end = html.match(startTagClose)) && (attr = html.match(dynamicArgAttribute) || html.match(attribute))) {
        attr.start = index
        advance(attr[0].length)
        attr.end = index
        match.attrs.push(attr)
      }
      if (end) {
        match.unarySlash = end[1]
        advance(end[0].length)
        match.end = index
        return match
      }
    }
  }

  // 处理parseStartTag结果
  function handleStartTag (match) {
    const tagName = match.tagName
    const unarySlash = match.unarySlash

    if (expectHTML) {
      if (lastTag === 'p' && isNonPhrasingTag(tagName)) {
        parseEndTag(lastTag)
      }
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        parseEndTag(tagName)
      }
    }

    const unary = isUnaryTag(tagName) || !!unarySlash

    const l = match.attrs.length
    const attrs = new Array(l)
    for (let i = 0; i < l; i++) {
      const args = match.attrs[i]
      const value = args[3] || args[4] || args[5] || ''
      const shouldDecodeNewlines = tagName === 'a' && args[1] === 'href'
        ? options.shouldDecodeNewlinesForHref
        : options.shouldDecodeNewlines
      attrs[i] = {
        name: args[1],
        value: decodeAttr(value, shouldDecodeNewlines)
      }
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        attrs[i].start = args.start + args[0].match(/^\s*/).length
        attrs[i].end = args.end
      }
    }

    if (!unary) {
      stack.push({ tag: tagName, lowerCasedTag: tagName.toLowerCase(), attrs: attrs, start: match.start, end: match.end })
      lastTag = tagName
    }

    if (options.start) {
      options.start(tagName, attrs, unary, match.start, match.end)
    }
  }

  // parse 结束标签
  /**
   * 该函数接收三个参数： 结束标签tagName、结束标签html字符串中的起始和结束位置start和end
   * 这三个参数其实都是可选的，根据传参的不同功能也不同
   * 第一种是三个参数都传递，用于处理普通的结束标签
   * 第二种是只传递tagName
   * 第三种是三个参数都不传递，用于处理栈中剩余未处理的标签
   */
  function parseEndTag (tagName, start, end) {
    let pos, lowerCasedTagName
    if (start == null) start = index
    if (end == null) end = index

    // Find the closest opened tag of the same type
    // 如果tagName存在，那么就从后往前遍历栈，在栈中寻找与tagName相同的标签并记录其所在的位置pos,如果tagName不存在，则将pos置为0
    if (tagName) {
      lowerCasedTagName = tagName.toLowerCase()
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break
        }
      }
    } else {
      // If no tag name is provided, clean shop
      pos = 0
    }

    /**
     * 当pos>=0时，开启一个for循环，从栈顶位置从后向前遍历直到pos处，如果发现stack栈中存在索引大于pos的元素，那么该元素一定是缺少闭合标签的。
     * 这是因为在正常情况下，stack栈的栈顶元素应该和当前元素的结束标签tagName匹配，也就是说正常的pos应该是栈顶位置，后面不应该再有元素，
     * 如果后面还有元素的话，那么后面的元素就都缺少闭合标签，那么这个时候如果是在非生产环境会抛出警告，告诉你缺少闭合标签。除此之外,
     * 还会调用options.end(stack[i].tag, start, end)立即将其闭合，这是为了保证解析结果的正确性
     */
    if (pos >= 0) {
      // Close all the open elements, up the stack
      for (let i = stack.length - 1; i >= pos; i--) {
        if (process.env.NODE_ENV !== 'production' &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          options.warn(
            `tag <${stack[i].tag}> has no matching end tag.`,
            { start: stack[i].start, end: stack[i].end }
          )
        }
        if (options.end) {
          options.end(stack[i].tag, start, end)
        }
      }

      // Remove the open elements from the stack
      // 最后把ops位置以后的元素都从stack栈中弹出，以及把lastTag更新为栈顶元素
      stack.length = pos
      lastTag = pos && stack[pos - 1].tag
    } else if (lowerCasedTagName === 'br') {
      /**
       * 如果pos没有大于等于0，即将tagName没有在stack栈中找到对应的开始标签时，pos为-1.那么此时再判断tagName是否为br或p标签，为什么要单独判断这两个标签呢？
       * 这是因为在浏览器中如果我们写了如下HTML：
       * <div>
       *  </br>
       *  </p>
       * </div>
       * 浏览器会自动把</br>标签解析为正常的 <br>标签，而对于</p>浏览器则自动将其补全为<p></p>，所以Vue为了与浏览器对这两个标签的行为保持一致，故对这两个便签单独判断处理，如下：
       * */
      if (options.start) {
        options.start(tagName, [], true, start, end)
      }
    } else if (lowerCasedTagName === 'p') {
      if (options.start) {
        options.start(tagName, [], false, start, end)
      }
      if (options.end) {
        options.end(tagName, start, end)
      }
    }
  }
}
/**
 *  上述代码大致可以分为三部分：
 * ·定义一些常量和变量
 * ·while循环
 * ·解析过程中用到的辅助函数
 *
 * 总结：这篇文章主要介绍了HTML解析器的工作流程以及工作原理，文章比较长，但是逻辑并不复杂。
 * 首先介绍了HTML解析器的工作流程，一句话概括就是：一边解析不同的内容一边调用对应的钩子函数生成对应的钩子函数生成对应的AST节点，最终完成将整个模板字符串转化成AST.
 * 接着介绍了HTML解析器是如何解析用户所写的模板字符串中各种类型的内容的，把各种类型的解析方式都分别进行了介绍。
 * 其次，介绍了在解析器内维护了一个栈，用来保证构建的AST节点层级与真正DOM层级一致。
*/
