/* @flow */

import { cached } from 'shared/util'
import { parseFilters } from './filter-parser'

const defaultTagRE = /\{\{((?:.|\r?\n)+?)\}\}/g
const regexEscapeRE = /[-.*+?^${}()|[\]\/\\]/g

const buildRegex = cached(delimiters => {
  const open = delimiters[0].replace(regexEscapeRE, '\\$&')
  const close = delimiters[1].replace(regexEscapeRE, '\\$&')
  return new RegExp(open + '((?:.|\\n)+?)' + close, 'g')
})

type TextParseResult = {
  expression: string,
  tokens: Array<string | { '@binding': string }>
}
/**
 * 文本解析器内部就干了三件事：
 * ·判断传入的文本是否包含变量
 * ·构造expression
 * ·构造tokens
 *
 * parseText函数接收两个参数，一个是传入的待解析的文本内容text,一个包裹变量的符号delimiters。
 */
export function parseText (
  text: string,
  delimiters?: [string, string]
): TextParseResult | void {
  const tagRE = delimiters ? buildRegex(delimiters) : defaultTagRE
  /**
   * 函数体内首先定义了变量tagRE,表示一个正则表达式。这个正则表达式是用来检查文本中是否包含变量的。
   * 我们知道，通常我们在模板中写变量时是这样写的：hello 。这里用{{}}包裹的内容就是变量。所以我们就知道，tagRE是用来检测文本内是否有{{}}。
   * 而tagRE又是可变的，它根据是否传入了delimiters参数从而有不同的值，也就是说如果没有传入delimirters参数，则是检测文本中是否包含{{}},
   * 如果传入了值，就会检测文本中是否包含传入的值。换句话说在开发Vue项目中，用户可以自定义文本内包含变量所使用的符号，假如你可以使用%包裹变量，如： hello%name%
   * 接下来用tagRE去匹配传入的文本内容，包含是否包含变量，若不包含，则直接返回
   */
  if (!tagRE.test(text)) {
    return
  }
  /**
   * 如果包含变量，接下来就会开启一个while循环，循环结束条件是tagRE.exec(text)的结果match是否为null, exec()方法是在一个字符串中执行匹配检索，
   * 如果它没有找到任何匹配就返回null,但是如果它找到了一个匹配就返回一个数组，例如：
   * tagRE.exec("hello {{name}}，I am {{age}}")
   * //返回：["{{name}}", "name", index: 6, input: "hello {{name}}，I am {{age}}", groups: undefined]
   * tagRE.exec("hello")
   * //返回：null
   * 可以看到，当匹配上时，匹配结果的第一个元素是字符串中第一个完整的带有包裹的变量，第二个元素是第一个被包裹的变量名，第三个元素是第一个元素在字符串中的起始位置
   * 接着看循环体内：
   * 首先取得字符串中第一个变量在字符串中的起始位置赋值给index,然后比较index和lastIndex的大小
   */
  const tokens = []
  const rawTokens = []
  /**
   * let lastIndex = tagRE.lastIndex = 0
   * 上面这行代码等于下面这两行代码：
   * tagRE.lastIndex = 0
   * let lastIndex = tagRE.lastIndex
   *
   *  这个lastIndex是什么呢？lastIndex就是tagRE.lastIndex，而tagRE.lastIndex又是什么呢？
   * 当调用exec()的正则表达式对象具有修饰符g时，它将把当前正则表达式对象的lastIndex属性设置为仅挨着匹配子串的字符位置，当同一个正则表达式第二次调用exec(),
   * 它会将从lastIndex属性所指示的字符串处开始检索，如果exec()没有发现任何匹配结果，它会将lastIndex重置为0。示例如下：
   * const tagRE = /\{\{((?:.|\n)+?)\}\}/g
   * tagRE.exec("hello {{name}}，I am {{age}}")
   * tagRE.lastIndex   // 14
   * 从示例中可以看到，tagRE.lastIndex就是第一个包裹变量最后一个}所在字符串中的位置。lastIndex初始值为0。
   */
  let lastIndex = tagRE.lastIndex = 0
  let match, index, tokenValue
  while ((match = tagRE.exec(text))) {
    index = match.index
    // push text token
    if (index > lastIndex) { // 当index > lastIndex时，表示变量前面有纯文本，那么就把这段纯文本取出来，存入rawToken中，同时再调用JSON.stringfy给这段文本包裹上双引号存入tokens中
      // 先把'{{'前面的文本放入tokens中
      rawTokens.push(tokenValue = text.slice(lastIndex, index))
      tokens.push(JSON.stringify(tokenValue))
    }
    // 如果index不大于lastIndex,那说明index也为0，即该文本一开始就是变量，例如：hello.那么此时变量前面没有纯文本，那就不用截取，直接取出匹配结果的第一个元素变量名，将其用_s()包裹存入tokens中，同时再把变量名构造成{'@binding': exp}存入rawTokens中
    // tag token
    // 取出'{{ }}'中间的变量exp
    const exp = parseFilters(match[1].trim())
    // 把变量exp改成_s(exp)形式也放入tokens中
    tokens.push(`_s(${exp})`)
    rawTokens.push({ '@binding': exp })
    // 设置lastIndex 以保证下一轮循环时，只从'}}'后面再开始匹配正则
    lastIndex = index + match[0].length // 接着，更新lastIndex以保证下一轮循环时，只从}}后面再开始匹配正则
  }
  // 接着，当while循环完毕时，表明文本中所有变量已经被解析完毕，如果此时lastIndex < text.length，那就说明最后一个变量的后面还有纯文本，那就将其再存入tokens和rawTokens中
  // 当剩下的text不再被讹正则匹配上时，表示所有变量已经处理完毕
  // 此时如果lastIndex < text.length, 表示在最后一个变量后面还有文本
  // 最后将后面的文本再加入到tokens中
  if (lastIndex < text.length) {
    rawTokens.push(tokenValue = text.slice(lastIndex))
    tokens.push(JSON.stringify(tokenValue))
  }

  // 最后把数组tokens中的所有元素用'+'拼接起来
  return {
    expression: tokens.join('+'),
    tokens: rawTokens
  }
}

/**
 * 总结； 本篇文章介绍了文本解析器的内部工作原理，文本解析器的作用就是将HTML解析得到的文本内容进行二次解析，解析文本内容中是否包含变量，
 * 如果包含变量，则将变量提取出来进行加工，为后续生产render函数做准备。
 */
