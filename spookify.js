let submit_button = document.createElement('button')
submit_button.setAttribute('contetn', 'test button content')
submit_button.setAttribute('class', 'btn')
submit_button.value = 'test value'
console.log(submit_button)

let wrapper = document.getElementById('button_wrapper')
wrapper.appendChild(submit_button)